// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import fx from "../provider/fixtures/eventos.json";
import { criarEvolutionGo } from "../provider/evolution-go";
import { GEMINI_MODELO_PADRAO, GEMINI_MODELO_RESERVA, criarLeitorGemini, geminiModelo, mimeAudioGemini, mimeBase, motivoDeErro } from "./midia";
import { custoMicros } from "./precos";

const CHAVE = "AIza-SEGREDO-DE-TESTE";
const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const ok = (texto: string) => json(200, { candidates: [{ content: { parts: [{ text: texto }] } }], usageMetadata: { promptTokenCount: 128, candidatesTokenCount: 20 } });

function leitor(respostas: Array<() => Response | Promise<Response>>) {
  let i = 0;
  const f = vi.fn(async (_u: string, _init?: RequestInit) => {
    const r = respostas[Math.min(i++, respostas.length - 1)]!;
    return r();
  });
  return { f, l: criarLeitorGemini({ apiKey: CHAVE, fetchFn: f as unknown as typeof fetch }) };
}
const corpoDe = (f: ReturnType<typeof vi.fn>, n = 0) => JSON.parse(String((f.mock.calls[n]![1] as RequestInit).body));
const urlDe = (f: ReturnType<typeof vi.fn>, n = 0) => String(f.mock.calls[n]![0]);

describe("mime do áudio", () => {
  it("audio/ogg; codecs=opus vira audio/ogg (tipo base, sem parâmetros) e a lista é validada", () => {
    expect(mimeBase("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(mimeBase("  AUDIO/OGG ;codecs=opus")).toBe("audio/ogg");
    expect(mimeAudioGemini("audio/ogg; codecs=opus")).toBe("audio/ogg");
    for (const m of ["audio/mp3", "audio/mpeg", "audio/wav", "audio/aac", "audio/flac", "audio/aiff", "audio/x-wav", "audio/mp4"]) expect(mimeAudioGemini(m), m).toBeTruthy();
    expect(mimeAudioGemini("audio/x-wav")).toBe("audio/wav");
    for (const m of ["video/mp4", "application/octet-stream", "image/png", "", "audio/amr"]) expect(mimeAudioGemini(m), m).toBeNull();
  });
  it("a fixture de áudio do WhatsApp (ogg opus) chega à Gemini como audio/ogg", async () => {
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: "00000000-0000-0000-0000-000000000001" });
    const r = prov.parseWebhook(fx.audio_com_base64);
    if (!("mensagem" in r)) throw new Error("ignorado");
    const { f, l } = leitor([() => ok("tomei o remédio")]);
    const res = await l.transcreverAudio(r.mensagem.base64, "audio/ogg; codecs=opus", 4);
    expect(res.texto).toBe("tomei o remédio");
    expect(corpoDe(f).contents[0].parts[1].inline_data.mime_type).toBe("audio/ogg");
    expect(corpoDe(f).contents[0].parts[1].inline_data.data).toBe(r.mensagem.base64);
  });
  it("formato que a Gemini não aceita é recusado ANTES da chamada, com o motivo", async () => {
    const { f, l } = leitor([() => ok("x")]);
    const r = await l.transcreverAudio("QUJD", "audio/amr", 3);
    expect(r).toMatchObject({ texto: null, motivo: expect.stringContaining("audio/amr") });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("modelo da Gemini", () => {
  it("o padrão é o gemini-3.5-flash-lite (o 2.5-flash foi aposentado) e GEMINI_MODEL manda", () => {
    const antes = process.env["GEMINI_MODEL"];
    try {
      delete process.env["GEMINI_MODEL"];
      expect(geminiModelo()).toBe("gemini-3.5-flash-lite");
      expect(GEMINI_MODELO_PADRAO).toBe("gemini-3.5-flash-lite");
      process.env["GEMINI_MODEL"] = "models/gemini-x";
      expect(geminiModelo()).toBe("gemini-x");
    } finally {
      if (antes === undefined) delete process.env["GEMINI_MODEL"];
      else process.env["GEMINI_MODEL"] = antes;
    }
  });
  it("preço do flash-lite: entrada 0,30, áudio e saída 2,50 por milhão (fonte: projeto financeiro)", () => {
    expect(custoMicros("gemini-3.5-flash-lite", { entrada: 0, saida: 1000, midia: 1000 })).toEqual({ micros: 5000, estimado: false });
    expect(custoMicros("gemini-2.5-flash", { entrada: 1, saida: 1 }).estimado).toBe(true); // aposentado: não está mais na tabela
  });
  it("404: tenta UMA vez o gemini-3.5-flash e, se der certo, transcreve", async () => {
    const { f, l } = leitor([() => json(404, { error: { status: "NOT_FOUND" } }), () => ok("próximas doses")]);
    const r = await l.transcreverAudio("QUJD", "audio/ogg; codecs=opus", 3);
    expect(r.texto).toBe("próximas doses");
    expect(f).toHaveBeenCalledTimes(2);
    expect(urlDe(f, 0)).toContain(`/models/${GEMINI_MODELO_PADRAO}:generateContent`);
    expect(urlDe(f, 1)).toContain(`/models/${GEMINI_MODELO_RESERVA}:generateContent`);
  });
  it("404 nos dois: desiste com o motivo claro (modelo não encontrado → trocar GEMINI_MODEL), sem segredo", async () => {
    const { f, l } = leitor([() => json(404, { error: { status: "NOT_FOUND" } })]);
    const r = await l.transcreverAudio("QUJD", "audio/ogg", 3);
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.texto).toBeNull();
    expect(r.motivo).toContain("modelo da Gemini não encontrado (404)");
    expect(r.motivo).toContain("GEMINI_MODEL");
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });
});

describe("falhas da Gemini viram motivo resumido (sem segredo, sem conteúdo)", () => {
  it("400 INVALID_ARGUMENT, 403 PERMISSION_DENIED, 429, 500 e rede", async () => {
    const casos: Array<[number, string, RegExp]> = [
      [400, "INVALID_ARGUMENT", /não aceitou o áudio.*400 INVALID_ARGUMENT/],
      [403, "PERMISSION_DENIED", /recusou a chave \(403 PERMISSION_DENIED\).*GEMINI_API_KEY/],
      [401, "UNAUTHENTICATED", /recusou a chave \(401/],
      [429, "RESOURCE_EXHAUSTED", /limite de uso.*429/],
      [503, "UNAVAILABLE", /indisponível \(503\)/],
    ];
    for (const [status, codigo, esperado] of casos) {
      const { f, l } = leitor([() => json(status, { error: { status: codigo, message: "texto com AIza-SEGREDO-DE-TESTE" } })]);
      const r = await l.transcreverAudio("QUJD", "audio/ogg", 3);
      expect(r.texto, String(status)).toBeNull();
      expect(r.motivo, String(status)).toMatch(esperado);
      expect(JSON.stringify(r)).not.toContain(CHAVE);
      expect(f).toHaveBeenCalledTimes(1); // só o 404 tenta o modelo reserva
    }
    const { l } = leitor([() => { throw new Error("rede"); }]);
    expect((await l.transcreverAudio("QUJD", "audio/ogg", 3)).motivo).toMatch(/rede ou tempo esgotado/);
  });
  it("resposta 200 vazia: texto null com motivo (áudio sem fala), mantendo o uso para o custo", async () => {
    const { l } = leitor([() => json(200, { candidates: [{ content: { parts: [{ text: "   " }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0 } })]);
    const r = await l.transcreverAudio("QUJD", "audio/ogg", 3);
    expect(r.texto).toBeNull();
    expect(r.motivo).toContain("vazia");
    expect(r.uso).toMatchObject({ midia: 100 });
  });
  it("foto: 200 devolve o texto; 400 tem motivo próprio; motivoDeErro cobre o resto", async () => {
    const { l } = leitor([() => ok("Zypred 50 mg")]);
    expect((await l.lerImagem("QUJD", "image/jpeg")).texto).toBe("Zypred 50 mg");
    const { l: l2 } = leitor([() => json(400, { error: { status: "INVALID_ARGUMENT" } })]);
    expect((await l2.lerImagem("QUJD", "image/jpeg")).motivo).toMatch(/não aceitou a imagem/);
    expect(motivoDeErro(418, "", "m", "imagem")).toBe("Gemini respondeu 418");
  });
});
