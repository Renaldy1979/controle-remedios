// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import fx from "./fixtures/eventos.json";
import { conectadaDe, erroNumeroInexistente, respostaUserCheck, criarEvolutionGo, envioOk, idDaMensagemEnviada, midiaBaixada, remetenteDoInfo, respostaDeBotao, telefoneDoJid } from "./evolution-go";
import { criarFake } from "./fake";
import { criarMeta } from "./meta";
import { criarProvedor, evolutionConfigurada } from "./index";
import { ErroEnvio, type MensagemRecebida } from "./types";
import { telefoneBr } from "./telefone";

const INSTANCIA = "00000000-0000-0000-0000-000000000001";
const p = criarEvolutionGo({ baseUrl: "https://evo.exemplo.test/", apiKey: "chave-de-teste", instanceId: INSTANCIA, fetchFn: vi.fn() as unknown as typeof fetch });
const msg = (k: keyof typeof fx): MensagemRecebida => {
  const r = p.parseWebhook(fx[k]);
  if (!("mensagem" in r)) throw new Error(`ignorado: ${r.ignorar}`);
  return r.mensagem;
};
const ignorado = (k: keyof typeof fx) => {
  const r = p.parseWebhook(fx[k]);
  return "ignorar" in r ? r.ignorar : null;
};

describe("Evolution Go — parseWebhook contra as fixtures", () => {
  it("texto: telefone só em dígitos (com o 9), id da mensagem e texto", () => {
    expect(msg("texto")).toMatchObject({ msgId: "3EB0AAA111", telefone: "5511912345678", numeroResposta: "5511912345678", tipo: "texto", texto: "tomei", acao: "" });
  });
  it("texto estendido e aparelho secundário (:12)", () => {
    expect(msg("texto_extendido").texto).toBe("como está o estoque?");
    expect(msg("texto_com_aparelho").telefone).toBe("5511912345678");
  });
  it("remetente @lid usa SenderAlt; só @lid sem alternativa é ignorado (nunca inventa telefone)", () => {
    expect(msg("remetente_lid").telefone).toBe("5511912345678");
    expect(ignorado("somente_lid")).toBe("sem_telefone");
  });
  it("áudio: sem base64 guarda a referência para baixar; com base64 leva o conteúdo", () => {
    const a = msg("audio");
    expect(a).toMatchObject({ tipo: "audio", base64: "", mime: "audio/ogg" });
    expect(a.midiaRef).toHaveProperty("audioMessage");
    const b = msg("audio_com_base64");
    expect(b.base64).toBe("T2dnUwACAAAAAAAAAAA=");
    expect(b.midiaRef).toBeNull();
    expect(JSON.stringify(b.midiaRef)).not.toContain("T2dnUw");
  });
  it("botão e lista: id de ação vira `acao`; id desconhecido segue como texto", () => {
    expect(msg("botao")).toMatchObject({ tipo: "botao" });
    expect(msg("botao_id_minusculo").tipo).toBe("botao");
    expect(msg("lista").tipo).toBe("botao");
    expect(respostaDeBotao({ buttonsResponseMessage: { selectedButtonID: "tomei" } })).toEqual({ id: "tomei", texto: "" });
    expect(respostaDeBotao({ listResponseMessage: { title: "Estoque", singleSelectReply: { selectedRowId: "estoque" } } })).toEqual({ id: "estoque", texto: "Estoque" });
    expect(respostaDeBotao({})).toBeNull();
  });
  it("imagem: legenda vira o texto e o mime é conhecido", () => {
    const i = msg("imagem");
    expect(i.tipo).toBe("imagem");
    expect(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]).toContain(i.mime);
  });
  it("grupo, mensagem própria, status e eventos que não são mensagem são ignorados", () => {
    expect(ignorado("grupo")).toBe("grupo");
    expect(ignorado("from_me")).toBe("propria");
    expect(ignorado("status")).toBe("status");
    expect(ignorado("recibo")).toBe("evento");
    expect(ignorado("presenca")).toBe("evento");
    expect(ignorado("conectado")).toBe("evento");
  });
  it("tipo não suportado (figurinha) vira `outro`, nunca erro", () => {
    expect(msg("tipo_nao_suportado").tipo).toBe("outro");
  });
  it("outra instância é ignorada; payload sem instanceId passa (a proteção é o segredo do caminho)", () => {
    expect(p.parseWebhook({ ...fx.texto, instanceId: "outra-instancia" })).toEqual({ ignorar: "instancia" });
    expect(p.parseWebhook({ ...fx.texto, instanceId: INSTANCIA.toUpperCase() })).toHaveProperty("mensagem");
    expect(p.parseWebhook(fx.texto_extendido)).toHaveProperty("mensagem");
  });
  it("lixo (null, texto, array) nunca lança", () => {
    for (const x of [null, "x", 1, [], {}, { event: "Message" }, { event: "Message", data: { Info: {} } }]) {
      expect(() => p.parseWebhook(x)).not.toThrow();
      expect("ignorar" in p.parseWebhook(x)).toBe(true);
    }
  });
  it("foto grande e áudio longo são recusados com aviso e sem carregar a mídia", () => {
    const grande = { ...fx.imagem, data: { ...fx.imagem.data, Message: { imageMessage: { mimetype: "image/jpeg", fileLength: 9 * 1024 * 1024 } } } };
    const r = p.parseWebhook(grande);
    expect(r).toMatchObject({ mensagem: { tipo: "recusa", aviso: "foto_grande", base64: "" } });
    const longo = { ...fx.audio, data: { ...fx.audio.data, Message: { audioMessage: { mimetype: "audio/ogg", seconds: 600 } } } };
    expect(p.parseWebhook(longo)).toMatchObject({ mensagem: { tipo: "recusa", aviso: "audio_longo" } });
  });
});

describe("Evolution Go — funções pequenas do formato (TODO verificar com mensagem real)", () => {
  it("telefoneDoJid / remetenteDoInfo", () => {
    expect(telefoneDoJid("5511912345678@s.whatsapp.net")).toBe("5511912345678");
    expect(telefoneDoJid("5511912345678:12@s.whatsapp.net")).toBe("5511912345678");
    expect(telefoneDoJid("123456789012345@lid")).toBe("");
    expect(telefoneDoJid("120363000000000000@g.us")).toBe("");
    expect(remetenteDoInfo({ Chat: "5511912345678@s.whatsapp.net" })).toBe("5511912345678");
  });
  it("telefone brasileiro antigo (sem o 9) ganha o 9 como no cadastro", () => {
    expect(telefoneBr("551187654321")).toBe("5511987654321");
    expect(telefoneBr("5511987654321")).toBe("5511987654321");
  });
  it("id da mensagem enviada (os dois formatos da doc) e sucesso do envio", () => {
    expect(idDaMensagemEnviada(fx.resposta_envio_doc)).toBe("3EB0BBB001");
    expect(idDaMensagemEnviada(fx.resposta_envio_exemplo)).toBe("3EB0BBB002");
    expect(idDaMensagemEnviada({})).toBe("");
    expect(envioOk(200, fx.resposta_envio_doc)).toBe(true);
    expect(envioOk(200, { error: "x" })).toBe(false);
    expect(envioOk(500, {})).toBe(false);
  });
  it("mídia baixada e estado da instância", () => {
    expect(midiaBaixada({ data: { base64: "AAAA", mimetype: "audio/ogg" } })).toEqual({ base64: "AAAA", mimetype: "audio/ogg" });
    expect(midiaBaixada({})).toBeNull();
    expect(conectadaDe({ data: { Connected: true, LoggedIn: true } })).toBe(true);
    expect(conectadaDe({ data: { Connected: true, LoggedIn: false } })).toBe(false);
    expect(conectadaDe({ state: "open" })).toBe(true);
    expect(conectadaDe({ state: "close" })).toBe(false);
    expect(conectadaDe({ algo: 1 })).toBeNull();
  });
});

describe("Evolution Go — chamadas HTTP (fetch simulado)", () => {
  const resp = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

  it("enviarTexto: POST /send/text com apikey e instanceId, número só em dígitos", async () => {
    const f = vi.fn(async () => resp(200, fx.resposta_envio_doc));
    const prov = criarEvolutionGo({ baseUrl: "https://evo.exemplo.test/", apiKey: "k1", instanceId: INSTANCIA, fetchFn: f as unknown as typeof fetch });
    const r = await prov.enviarTexto("+55 (11) 91234-5678", "olá");
    expect(r.messageId).toBe("3EB0BBB001");
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.exemplo.test/send/text");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: "k1", instanceId: INSTANCIA });
    expect(JSON.parse(String(init.body))).toEqual({ number: "5511912345678", text: "olá" });
    expect(init.redirect).toBe("manual");
  });
  it("enviarTexto: 4xx é recusa CLARA; 5xx e queda de rede são AMBÍGUOS (não reenviar)", async () => {
    const mk = (f: () => Promise<Response>) => criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: f as unknown as typeof fetch });
    await expect(mk(async () => resp(400, {})).enviarTexto("5511912345678", "x")).rejects.toMatchObject({ name: "ErroEnvio", recusaClara: true });
    await expect(mk(async () => resp(502, {})).enviarTexto("5511912345678", "x")).rejects.toMatchObject({ recusaClara: false });
    await expect(mk(async () => { throw new Error("rede"); }).enviarTexto("5511912345678", "x")).rejects.toBeInstanceOf(ErroEnvio);
  });
  it("presença, status e download de mídia", async () => {
    const f = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/instance/status")) return resp(200, { data: { Connected: true, LoggedIn: true } });
      if (url.endsWith("/message/downloadmedia")) return resp(200, { data: { base64: "QUJD", mimetype: "audio/ogg" } });
      return resp(200, {});
    });
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: f as unknown as typeof fetch });
    await prov.presenca("5511912345678");
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject({ number: "5511912345678", state: "composing" });
    expect(await prov.statusInstancia()).toEqual({ conectada: true });
    expect(await prov.baixarMidia({ audioMessage: {} })).toEqual({ base64: "QUJD", mimetype: "audio/ogg" });
  });
  it("instância fora do ar (status não-200) é 'desconectada'", async () => {
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: (async () => resp(503, {})) as unknown as typeof fetch });
    expect(await prov.statusInstancia()).toEqual({ conectada: false });
  });
});

describe("provedor fake, meta e escolha pelo ambiente", () => {
  it("fake grava em memória, falha sob comando e simula presença", async () => {
    const f = criarFake();
    await f.presenca("5511912345678");
    expect((await f.enviarTexto("5511912345678", "oi")).messageId).toBe("fake-1");
    f.falharProximos(1);
    await expect(f.enviarTexto("5511912345678", "oi")).rejects.toMatchObject({ recusaClara: true });
    expect(f.enviados).toHaveLength(1);
    expect(f.presencas).toEqual(["5511912345678"]);
  });
  it("meta é esqueleto: nada implementado", () => {
    expect(() => criarMeta().enviarTexto("1", "x")).toThrow(/não implementado/);
  });
  it("o fake é RECUSADO com APP_ENV=production; sem variáveis da Evolution não há provedor", () => {
    const antes = { ...process.env };
    try {
      process.env["WHATSAPP_PROVIDER"] = "fake";
      process.env["APP_ENV"] = "production";
      expect(() => criarProvedor()).toThrow(/production/);
      process.env["APP_ENV"] = "";
      expect(criarProvedor()?.id).toBe("fake");
      process.env["WHATSAPP_PROVIDER"] = "evolution-go";
      delete process.env["EVOLUTION_BASE_URL"];
      expect(criarProvedor()).toBeNull();
      process.env["EVOLUTION_BASE_URL"] = "https://e";
      process.env["EVOLUTION_API_KEY"] = "k";
      process.env["EVOLUTION_INSTANCE_ID"] = INSTANCIA;
      expect(criarProvedor()?.id).toBe("evolution-go");
    } finally {
      for (const k of ["WHATSAPP_PROVIDER", "APP_ENV", "EVOLUTION_BASE_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE_ID"]) {
        if (antes[k] === undefined) delete process.env[k];
        else process.env[k] = antes[k];
      }
    }
  });
});

describe("Evolution Go — consulta 'está no WhatsApp?' e número inexistente (TODO verificar com mensagem real)", () => {
  it("respostaUserCheck aceita os formatos prováveis e devolve null para o desconhecido", () => {
    expect(respostaUserCheck({ data: [{ Query: "5599988887777", IsInWhatsapp: true, JID: "559988887777@s.whatsapp.net" }] })).toEqual({ existe: true, numero: "559988887777" });
    expect(respostaUserCheck({ data: { Users: [{ Query: "5599988887777", IsInWhatsapp: false }] } })).toEqual({ existe: false, numero: "5599988887777" });
    expect(respostaUserCheck([{ IsInWhatsapp: true, JID: "5599988887777:3@s.whatsapp.net" }])).toEqual({ existe: true, numero: "5599988887777" });
    expect(respostaUserCheck({ algo: 1 })).toBeNull();
    expect(respostaUserCheck(null)).toBeNull();
  });
  it("erroNumeroInexistente só para 4xx que falam de número/WhatsApp inexistente", () => {
    expect(erroNumeroInexistente(400, { error: "number not on whatsapp" })).toBe(true);
    expect(erroNumeroInexistente(400, { error: "invalid number" })).toBe(true);
    expect(erroNumeroInexistente(500, { error: "number not on whatsapp" })).toBe(false);
    expect(erroNumeroInexistente(401, { error: "unauthorized" })).toBe(false);
  });
  it("numeroNoWhatsapp: POST /user/check e null quando a rota falha", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify({ data: [{ IsInWhatsapp: true, JID: "559988887777@s.whatsapp.net" }] }), { status: 200 }));
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: f as unknown as typeof fetch });
    expect(await prov.numeroNoWhatsapp("5599988887777")).toEqual({ existe: true, numero: "559988887777" });
    expect(f.mock.calls[0]![0]).toBe("https://e/user/check");
    expect(JSON.parse(String(f.mock.calls[0]![1]!.body))).toMatchObject({ number: ["5599988887777"] });
    const quebrado = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: (async () => { throw new Error("x"); }) as unknown as typeof fetch });
    expect(await quebrado.numeroNoWhatsapp("5599988887777")).toBeNull();
  });
  it("envio recusado por número inexistente marca a falha para a retentativa na outra forma", async () => {
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: (async () => new Response(JSON.stringify({ error: "number not on whatsapp" }), { status: 400 })) as unknown as typeof fetch });
    await expect(prov.enviarTexto("5599988887777", "x")).rejects.toMatchObject({ recusaClara: true, numeroInexistente: true });
  });
});

describe("Evolution Go — credencial por rota (token da instância) e diagnóstico de 401", () => {
  const ok = () => new Response(JSON.stringify({ data: { Connected: true, LoggedIn: true } }), { status: 200 });
  const rotas = async (cfg: { apiKey: string; instanceToken?: string }) => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => ok());
    const prov = criarEvolutionGo({ baseUrl: "https://e", ...cfg, instanceId: INSTANCIA, fetchFn: f as unknown as typeof fetch });
    await prov.enviarTexto("5599988887777", "x").catch(() => {});
    await prov.presenca("5599988887777");
    await prov.statusInstancia();
    await prov.numeroNoWhatsapp("5599988887777");
    await prov.baixarMidia({ audioMessage: {} });
    return f.mock.calls.map(([u, i]) => ({ rota: new URL(u).pathname, apikey: (i!.headers as Record<string, string>)["apikey"], instanceId: (i!.headers as Record<string, string>)["instanceId"] }));
  };
  it("com EVOLUTION_INSTANCE_TOKEN: TODAS as rotas da instância levam o token da instância (a chave global não vai)", async () => {
    const r = await rotas({ apiKey: "GLOBAL", instanceToken: "TOKEN-INST" });
    expect(r.map((x) => x.rota)).toEqual(["/send/text", "/message/presence", "/instance/status", "/user/check", "/message/downloadmedia"]);
    for (const x of r) {
      expect(x.apikey, x.rota).toBe("TOKEN-INST");
      expect(x.instanceId, x.rota).toBe(INSTANCIA);
    }
  });
  it("sem o token da instância: cai para EVOLUTION_API_KEY (compatível com o que já estava configurado)", async () => {
    for (const r of await rotas({ apiKey: "GLOBAL" })) expect(r.apikey).toBe("GLOBAL");
    for (const r of await rotas({ apiKey: "GLOBAL", instanceToken: "  " })) expect(r.apikey).toBe("GLOBAL");
  });
  it("401 e 403 no envio viram ErroEnvio de autenticação com a orientação clara (sem segredo)", async () => {
    for (const status of [401, 403]) {
      const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "SEGREDO-GLOBAL", instanceToken: "SEGREDO-INST", instanceId: INSTANCIA, fetchFn: (async () => new Response("{}", { status })) as unknown as typeof fetch });
      const e = await prov.enviarTexto("5599988887777", "x").catch((x) => x);
      expect(e).toMatchObject({ recusaClara: true, autenticacao: true, numeroInexistente: false });
      expect(e.message).toContain(`Evolution recusou a chave (${status})`);
      expect(e.message).toContain("EVOLUTION_INSTANCE_TOKEN");
      expect(e.message).not.toMatch(/SEGREDO/);
    }
  });
  it("status com chave recusada não vira 'desconectada' (estado desconhecido)", async () => {
    const prov = criarEvolutionGo({ baseUrl: "https://e", apiKey: "k", instanceId: INSTANCIA, fetchFn: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch });
    expect(await prov.statusInstancia()).toEqual({ conectada: null });
  });
  it("evolutionConfigurada: o token da instância sozinho basta (com base e id)", () => {
    const antes = { ...process.env };
    try {
      process.env["EVOLUTION_BASE_URL"] = "https://e";
      process.env["EVOLUTION_INSTANCE_ID"] = INSTANCIA;
      delete process.env["EVOLUTION_API_KEY"];
      delete process.env["EVOLUTION_INSTANCE_TOKEN"];
      expect(evolutionConfigurada()).toBe(false);
      process.env["EVOLUTION_INSTANCE_TOKEN"] = "t";
      expect(evolutionConfigurada()).toBe(true);
      delete process.env["EVOLUTION_INSTANCE_TOKEN"];
      process.env["EVOLUTION_API_KEY"] = "k";
      expect(evolutionConfigurada()).toBe(true);
    } finally {
      for (const k of ["EVOLUTION_BASE_URL", "EVOLUTION_INSTANCE_ID", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE_TOKEN"]) {
        if (antes[k] === undefined) delete process.env[k];
        else process.env[k] = antes[k];
      }
    }
  });
});
