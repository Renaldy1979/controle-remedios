import { describe, expect, it } from "vitest";
import { whereToQueries } from "./data/appwrite";
import { GeminiTranscriber } from "./transcription/gemini";
import { signBody, verifySignature } from "./inbound/signature";
import { requestLoginCode, verifyLoginCode } from "./login";
import { seal, unseal } from "./seal";
import { backoffSeconds } from "./outbox";
import { interpretText } from "./inbound/interpret";
import { buildWorld, FAMILY_ID, GROUP_ID, PHONES, seedDose } from "./testing/world";

const DOSE_TIME = new Date("2026-10-15T17:00:00.000Z");

describe("agendador", () => {
  it("lembra no horário, reenvia 1x após 15 min, marca atrasada, e esquecida após 2 h avisando a família", async () => {
    const w = buildWorld();
    seedDose(w, "dose-zyp", "pat-adelino", "med-zypred", DOSE_TIME);
    const kinds = () => w.outbox().filter((o) => o["kind"] === "dose_reminder").length;

    await w.tick();
    expect(kinds()).toBe(1);

    w.advance(15);
    await w.tick();
    await w.tick();
    expect(kinds()).toBe(2); // reenvio único
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("late");

    w.advance(105); // 2 h depois
    const r = await w.tick();
    expect(r.missed).toBe(1);
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("missed");
    const missed = w.outbox().filter((o) => o["kind"] === "dose_missed");
    // Ana (avisos da família) e Rosa (responsável) são avisadas.
    expect(missed).toHaveLength(2);
    await w.flushOutbox();
    const warn = w.channel.sent.find((m) => m.text.includes("Dose esquecida"))!;
    expect(warn.text).toContain("Adelino");
    expect(warn.buttons!.some((b) => b.kind === "call")).toBe(true);
    expect(warn.buttons!.some((b) => b.label === "Já tomou")).toBe(true);

    // Dose esquecida não gera mais lembretes.
    w.advance(1);
    await w.tick();
    expect(kinds()).toBe(2);
  });

  it("dose tomada pelo painel/outro canal não recebe lembrete", async () => {
    const w = buildWorld();
    seedDose(w, "dose-zyp", "pat-adelino", "med-zypred", DOSE_TIME, "taken");
    await w.tick();
    expect(w.outbox().filter((o) => String(o["kind"]).startsWith("dose_"))).toHaveLength(0);
  });

  it("recuperação do agendador atrasado manda um lembrete só (já como atrasado), sem duplicar", async () => {
    const w = buildWorld();
    seedDose(w, "dose-zyp", "pat-adelino", "med-zypred", DOSE_TIME);
    w.advance(20);
    await w.tick();
    await w.tick();
    expect(w.outbox().filter((o) => o["kind"] === "dose_reminder")).toHaveLength(1);
  });

  it("gera as doses do dia nos minutos redondos (idempotente) e emite heartbeat a cada passo", async () => {
    const w = buildWorld({ withTreatments: true });
    const first = await w.tick();
    expect(first.dosesGenerated).toBe(5);
    const again = await w.tick();
    expect(again.dosesGenerated).toBe(0);
    expect(w.monitor.heartbeats.filter((h) => h.name === "scheduler")).toHaveLength(2);
  });

  it("falha numa família não derruba o passo e dispara alerta; heartbeat continua", async () => {
    const w = buildWorld();
    w.domain.generateDoseEvents = async () => {
      throw new Error("boom");
    };
    const r = await w.tick();
    expect(r.errors).toBe(1);
    expect(w.monitor.alerts.some((a) => a.kind === "scheduler_error")).toBe(true);
    expect(w.monitor.heartbeats).toHaveLength(1);
  });

  it("avisa estoque baixo e receita vencendo uma vez só, com 'Eu cuido disso'", async () => {
    const w = buildWorld({ zypredBalance: 20 }); // 5 dias → crítico
    await w.tick();
    await w.tick();
    const low = w.outbox().filter((o) => o["kind"] === "low_stock");
    expect(low).toHaveLength(1);
    expect(w.outbox().filter((o) => o["kind"] === "prescription_expiring")).toHaveLength(1);
    await w.flushOutbox();
    expect(w.channel.sent.find((m) => m.text.includes("Estoque baixo"))?.text).toContain("5 dias");
  });

  it("resumo diário às 20:00, uma vez por dia, para o grupo quando configurado", async () => {
    const w = buildWorld({ now: new Date("2026-10-15T23:00:00.000Z"), settings: { whatsapp_group_id: GROUP_ID } }); // 20:00 local
    seedDose(w, "d1", "pat-adelino", "med-zypred", DOSE_TIME, "taken");
    seedDose(w, "d2", "pat-adelino", "med-zypred", new Date("2026-10-15T14:00:00.000Z"), "missed");
    const r = await w.tick();
    expect(r.summaries).toBe(1);
    await w.tick();
    w.advance(30);
    await w.tick();
    const summaries = w.outbox().filter((o) => o["kind"] === "daily_summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!["target_group_id"]).toBe(GROUP_ID);
    await w.flushOutbox();
    const msg = w.channel.sent.find((m) => m.text.includes("Resumo do dia"))!;
    expect(msg.isGroup).toBe(true);
    expect(msg.text).toContain("1 tomadas, 1 esquecidas");
    expect(msg.text).toContain("15/10/2026");
  });

  it("antes das 20:00 não há resumo", async () => {
    const w = buildWorld();
    expect((await w.tick()).summaries).toBe(0);
  });
});

describe("login por código", () => {
  it("fluxo completo: pede, recebe no WhatsApp, valida uma vez", async () => {
    const w = buildWorld();
    expect(await requestLoginCode(w.loginDeps, PHONES.ana)).toEqual({ ok: true });
    const sent = w.channel.sent.find((m) => m.text.includes("Código de acesso"))!;
    expect(sent.to).toBe(PHONES.ana);
    const code = /\*(\d{6})\*/.exec(sent.text)![1]!;

    // Só o hash foi gravado; a outbox não guarda o código.
    const stored = w.store.all("login_codes")[0]!;
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(JSON.stringify(w.outbox())).not.toContain(code);

    expect(await verifyLoginCode(w.loginDeps, PHONES.ana, "000000")).toEqual({ ok: false });
    const ok = await verifyLoginCode(w.loginDeps, PHONES.ana, code);
    expect(ok.ok).toBe(true);
    // Uso único.
    expect(await verifyLoginCode(w.loginDeps, PHONES.ana, code)).toEqual({ ok: false });
  });

  it("número desconhecido: resposta idêntica e nada é enviado nem gravado", async () => {
    const w = buildWorld();
    expect(await requestLoginCode(w.loginDeps, PHONES.stranger)).toEqual({ ok: true });
    expect(w.channel.sent).toHaveLength(0);
    expect(w.store.all("login_codes")).toHaveLength(0);
    expect(await verifyLoginCode(w.loginDeps, PHONES.stranger, "123456")).toEqual({ ok: false });
  });

  it("intervalo mínimo entre envios e limite por hora", async () => {
    const w = buildWorld();
    await requestLoginCode(w.loginDeps, PHONES.ana);
    await requestLoginCode(w.loginDeps, PHONES.ana);
    expect(w.store.all("login_codes")).toHaveLength(1);
    for (let i = 0; i < 8; i++) {
      w.advance(2);
      await requestLoginCode(w.loginDeps, PHONES.ana);
    }
    expect(w.store.all("login_codes").length).toBeLessThanOrEqual(5);
  });

  it("limite de tentativas queima o código; expirado não vale", async () => {
    const w = buildWorld();
    await requestLoginCode(w.loginDeps, PHONES.ana);
    const code = /\*(\d{6})\*/.exec(w.channel.sent[0]!.text)![1]!;
    for (let i = 0; i < 5; i++) await verifyLoginCode(w.loginDeps, PHONES.ana, "111111");
    expect(await verifyLoginCode(w.loginDeps, PHONES.ana, code)).toEqual({ ok: false });

    const w2 = buildWorld();
    await requestLoginCode(w2.loginDeps, PHONES.ana);
    const code2 = /\*(\d{6})\*/.exec(w2.channel.sent[0]!.text)![1]!;
    w2.advance(11);
    expect(await verifyLoginCode(w2.loginDeps, PHONES.ana, code2)).toEqual({ ok: false });
  });

  it("aceita o telefone digitado sem formatação", async () => {
    const w = buildWorld();
    await requestLoginCode(w.loginDeps, "(11) 99999-0001");
    expect(w.channel.sent[0]?.to).toBe(PHONES.ana);
  });
});

describe("peças pequenas", () => {
  it("assinatura HMAC", () => {
    const body = '{"a":1}';
    const sig = signBody(body, "s");
    expect(verifySignature(body, sig, "s")).toBe(true);
    expect(verifySignature(`${body} `, sig, "s")).toBe(false);
    expect(verifySignature(body, sig, "outro")).toBe(false);
    expect(verifySignature(body, undefined, "s")).toBe(false);
  });

  it("selo do código: abre com o segredo certo, falha com outro", () => {
    const sealed = seal("123456", "x");
    expect(unseal(sealed, "x")).toBe("123456");
    expect(unseal(sealed, "y")).toBeNull();
    expect(sealed).not.toContain("123456");
  });

  it("backoff exponencial com teto", () => {
    const cfg = { baseBackoffSec: 30, maxBackoffSec: 1800 };
    expect([1, 2, 3, 4].map((n) => backoffSeconds(n, cfg))).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(20, cfg)).toBe(1800);
  });

  it("interpretação de texto", () => {
    expect(interpretText("Tomei!")).toBe("dose_taken");
    expect(interpretText("já tomou o zypred?")).toBe("dose_status");
    expect(interpretText("Como está o estoque?")).toBe("stock_status");
    expect(interpretText("quais as próximas doses")).toBe("next_doses");
    expect(interpretText("ele não tomou ainda")).toBe("not_taken");
    expect(interpretText("bom dia")).toBe("help");
    expect(interpretText("asdf")).toBe("unknown");
  });

  it("filtros viram queries do Appwrite", () => {
    const q = whereToQueries({ status: { in: ["queued", "failed"] }, next_attempt_at: { lte: "2026-01-01T00:00:00.000Z" }, active: true }, { limit: 10, orderBy: "next_attempt_at" });
    const parsed = q.map((x) => JSON.parse(x) as { method: string; attribute?: string; values?: unknown[] });
    expect(parsed).toContainEqual({ method: "equal", attribute: "status", values: ["queued", "failed"] });
    expect(parsed).toContainEqual({ method: "lessThanEqual", attribute: "next_attempt_at", values: ["2026-01-01T00:00:00.000Z"] });
    expect(parsed).toContainEqual({ method: "equal", attribute: "active", values: [true] });
    expect(parsed.some((x) => x.method === "limit" && x.values?.[0] === 10)).toBe(true);
  });

  it("Gemini: monta a chamada com o áudio em base64 e devolve o texto; erro não vaza corpo", async () => {
    let body: { contents: Array<{ parts: Array<{ inlineData?: { data: string; mimeType: string } }> }> } | undefined;
    const ok = new GeminiTranscriber({
      apiKey: "k",
      fetch: (async (_u: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: " tomei o zypred " }] } }] }));
      }) as never,
    });
    await expect(ok.transcribe({ audio: new Uint8Array([1, 2]), mimeType: "audio/ogg; codecs=opus", language: "pt-BR" })).resolves.toEqual({ text: "tomei o zypred" });
    expect(body!.contents[0]!.parts[1]!.inlineData).toEqual({ mimeType: "audio/ogg", data: "AQI=" });
    const bad = new GeminiTranscriber({ apiKey: "k", fetch: (async () => new Response("texto sensível", { status: 500 })) as never });
    await expect(bad.transcribe({ audio: new Uint8Array(), mimeType: "audio/ogg", language: "pt-BR" })).rejects.toThrow("HTTP 500");
  });

  it("isolamento: a fábrica de dados só enxerga a própria família", async () => {
    const w = buildWorld();
    w.store.seed("patients", "fam-outra", "pat-intruso", { name: "Intruso", active: true });
    const mine = await w.dataFor(FAMILY_ID).find("patients");
    expect(mine.map((p) => p.$id)).not.toContain("pat-intruso");
  });
});
