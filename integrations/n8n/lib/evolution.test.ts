import { describe, expect, it } from "vitest";
import {
  atualizarFalhas, chaveIdempotencia, corpoBaixarMidia, corpoConversa, corpoDoWebhook, corpoEnvioTexto, envioOk, idDaMensagemEnviada,
  lembretesParaEnviar, limitarRajada, midiaBaixada, normalizarEvento, planejarRespostas, soDigitos, telefoneDoJid,
  textoAlerta, transcricaoUtil,
} from "./evolution";
import fx from "./fixtures/eventos.json";

const AGORA = Date.parse("2026-10-22T12:00:30-03:00");
const norm = (k: keyof typeof fx) => normalizarEvento(fx[k], { agoraMs: AGORA });

describe("normalizarEvento — mensagens que o fluxo atende", () => {
  it("texto simples: telefone só em dígitos, id da mensagem e texto", () => {
    const r = norm("texto");
    expect(r).toMatchObject({ acao: "processar", tipo: "texto", telefone: "5511912345678", messageId: "3EB0AAA111", texto: "tomei", acaoApi: "" });
    expect(r.idadeSegundos).toBe(30);
  });
  it("texto estendido e aparelho secundário (:12)", () => {
    expect(norm("texto_extendido").texto).toBe("como está o estoque?");
    expect(norm("texto_com_aparelho").telefone).toBe("5511912345678");
  });
  it("aceita o corpo embrulhado como o webhook do N8N entrega ({ headers, body })", () => {
    const r = normalizarEvento({ headers: { host: "x" }, query: {}, body: fx.texto }, { agoraMs: AGORA });
    expect(r.acao).toBe("processar");
    expect(corpoDoWebhook({ body: fx.texto })).toBe(fx.texto);
  });
  it("remetente @lid usa SenderAlt; só @lid sem alternativa é ignorado (nunca inventa telefone)", () => {
    expect(norm("remetente_lid").telefone).toBe("5511912345678");
    expect(norm("somente_lid")).toMatchObject({ acao: "ignorar", motivo: "sem_telefone" });
  });
  it("áudio: devolve a referência da mídia sem copiar o base64 para dentro de `message`", () => {
    const a = norm("audio");
    expect(a).toMatchObject({ acao: "processar", tipo: "audio", texto: "" });
    expect(a.midia).toMatchObject({ mimetype: "audio/ogg; codecs=opus", base64: "", url: "" });
    expect(a.midia!.message).toHaveProperty("audioMessage");
    const b = norm("audio_com_base64");
    expect(b.midia!.base64).toBe("T2dnUwACAAAAAAAAAAA=");
    expect(JSON.stringify(b.midia!.message)).not.toContain("T2dnUw");
  });
  it("botão com id de ação vira `acao`; id desconhecido segue como texto; lista também", () => {
    expect(norm("botao")).toMatchObject({ tipo: "botao", acaoApi: "tomei", texto: "" });
    expect(norm("botao_id_minusculo")).toMatchObject({ acaoApi: "", texto: "Qualquer" });
    expect(norm("lista")).toMatchObject({ tipo: "botao", texto: "Losartana 50 mg" });
  });
  it("imagem segue como a legenda (a conversa em código não lê imagem)", () => {
    expect(norm("imagem")).toMatchObject({ acao: "processar", tipo: "imagem", texto: "receita nova" });
  });
});

describe("normalizarEvento — o que é ignorado", () => {
  it.each([
    ["from_me", "enviada_por_nos"],
    ["grupo", "grupo"],
    ["status", "status_ou_broadcast"],
    ["recibo", "nao_e_mensagem"],
    ["presenca", "nao_e_mensagem"],
    ["conectado", "nao_e_mensagem"],
    ["tipo_nao_suportado", "tipo_nao_suportado"],
  ] as const)("%s → ignorar (%s)", (k, motivo) => {
    expect(norm(k)).toMatchObject({ acao: "ignorar", motivo });
  });
  it("mensagem antiga (backlog) é ignorada; o limite é configurável", () => {
    const depois = AGORA + 2 * 3600_000;
    expect(normalizarEvento(fx.texto, { agoraMs: depois })).toMatchObject({ acao: "ignorar", motivo: "antiga" });
    expect(normalizarEvento(fx.texto, { agoraMs: depois, idadeMaximaMin: 600 }).acao).toBe("processar");
  });
  it("payload estranho nunca lança erro", () => {
    for (const lixo of [null, undefined, 42, "texto", [], {}, { event: "Message" }, { event: "Message", data: { Info: null } }, { event: "Message", data: { Info: { ID: "x" } } }]) {
      expect(normalizarEvento(lixo).acao).toBe("ignorar");
    }
  });
  it("o motivo e o resultado de uma mensagem ignorada não carregam o texto da mensagem", () => {
    expect(JSON.stringify(norm("grupo"))).not.toContain("tomei");
  });
});

describe("telefoneDoJid", () => {
  it("só contato privado com telefone", () => {
    expect(telefoneDoJid("5511912345678@s.whatsapp.net")).toBe("5511912345678");
    expect(telefoneDoJid("5511912345678:3@s.whatsapp.net")).toBe("5511912345678");
    for (const j of ["123@lid", "x@g.us", "status@broadcast", "12@s.whatsapp.net", "", null, 5]) expect(telefoneDoJid(j)).toBe("");
  });
  it("soDigitos", () => expect(soDigitos("+55 (11) 91234-5678")).toBe("5511912345678"));
});

describe("chamada à API de conversa", () => {
  it("Idempotency-Key estável por mensagem e limitada", () => {
    expect(chaveIdempotencia("3EB0AAA111")).toBe("evo-3EB0AAA111");
    expect(chaveIdempotencia("x".repeat(500)).length).toBe(120);
  });
  it("corpo: texto ou acao, nunca o telefone", () => {
    const e = norm("texto");
    expect(corpoConversa(e)).toEqual({ messageId: "3EB0AAA111", texto: "tomei" });
    expect(corpoConversa(norm("botao"))).toEqual({ messageId: "3EB0AAA131", acao: "tomei" });
    expect(corpoConversa(norm("audio"), "tomei o remédio")).toEqual({ messageId: "3EB0AAA121", texto: "tomei o remédio" });
    expect(JSON.stringify(corpoConversa(e))).not.toContain("5511");
  });
  it("transcrição vazia ou de uma letra não vale", () => {
    expect(transcricaoUtil("  ")).toBe("");
    expect(transcricaoUtil("a")).toBe("");
    expect(transcricaoUtil(" tomei ")).toBe("tomei");
    expect(transcricaoUtil(undefined)).toBe("");
  });
});

describe("resposta da API → envios", () => {
  it("cada resposta vira um /send/text para o remetente", () => {
    const p = planejarRespostas({ intent: "dose_tomada", respostas: [{ texto: "✅ Anotado" }, { texto: "Faltam 3 dias" }] }, "+55 11 91234-5678");
    expect(p.livre).toBe(false);
    expect(p.envios).toEqual([{ number: "5511912345678", text: "✅ Anotado" }, { number: "5511912345678", text: "Faltam 3 dias" }]);
  });
  it("intent livre → agente de IA (e só ele)", () => {
    expect(planejarRespostas({ intent: "livre", respostas: [] }, "5511912345678")).toEqual({ livre: true, envios: [] });
  });
  it("sem resposta e sem intent não é 'livre' (não chama IA por engano)", () => {
    expect(planejarRespostas({}, "5511912345678").livre).toBe(false);
    expect(planejarRespostas(null, "5511912345678").envios).toEqual([]);
  });
  it("corpo do envio só com dígitos", () => expect(corpoEnvioTexto("+55 (11) 91234-5678", "oi")).toEqual({ number: "5511912345678", text: "oi" }));
});

describe("resposta do envio (formatos da doc)", () => {
  it("id da mensagem enviada nos dois formatos documentados, e vazio quando não vem", () => {
    expect(idDaMensagemEnviada(fx.resposta_envio_doc)).toBe("3EB0BBB001");
    expect(idDaMensagemEnviada(fx.resposta_envio_exemplo)).toBe("3EB0BBB002");
    expect(idDaMensagemEnviada({})).toBe("");
    expect(idDaMensagemEnviada(null)).toBe("");
  });
  it("envioOk: 2xx sem erro; sem id continua ok (não duplicar); 4xx/5xx/erro no corpo não", () => {
    expect(envioOk(200, fx.resposta_envio_doc)).toBe(true);
    expect(envioOk(201, {})).toBe(true);
    expect(envioOk(200, "texto")).toBe(true);
    expect(envioOk(500, {})).toBe(false);
    expect(envioOk(401, { error: "unauthorized" })).toBe(false);
    expect(envioOk(200, { error: "instance not connected" })).toBe(false);
    expect(envioOk(undefined, {})).toBe(false);
  });
});

describe("mídia", () => {
  it("corpo do download e leitura da resposta (formato ainda a confirmar)", () => {
    expect(corpoBaixarMidia({ audioMessage: {} })).toEqual({ message: { audioMessage: {} } });
    expect(midiaBaixada({ data: { base64: "QQ==", mimetype: "audio/ogg" } })).toEqual({ base64: "QQ==", mimetype: "audio/ogg" });
    expect(midiaBaixada({ base64: "QQ==" })).toEqual({ base64: "QQ==", mimetype: "" });
    expect(midiaBaixada({})).toBeNull();
  });
});

describe("lembretes e anti-bloqueio", () => {
  const dados = {
    mensagens: [
      { id: "f1.a", telefone: "5511911112222", texto: "Hora do remédio", tipo: "dose_reminder", opcoes: [] },
      { id: "f1.b", telefone: "+55 11 93333-4444", texto: "Outro", tipo: "dose_missed" },
      { id: "", telefone: "5511911112222", texto: "sem id" },
      { id: "f1.c", telefone: "123", texto: "telefone curto" },
      { id: "f1.d", telefone: "5511911112222", texto: "" },
      "lixo",
    ],
  };
  it("só aproveita itens completos e normaliza o telefone", () => {
    const l = lembretesParaEnviar(dados);
    expect(l.map((x) => x.id)).toEqual(["f1.a", "f1.b"]);
    expect(l[1]!.telefone).toBe("5511933334444");
    expect(lembretesParaEnviar(null)).toEqual([]);
  });
  it("limita a rajada e devolve os adiados", () => {
    const r = limitarRajada([1, 2, 3, 4, 5], 3);
    expect(r).toEqual({ enviar: [1, 2, 3], adiados: [4, 5] });
    expect(limitarRajada([1], 0).enviar).toEqual([]);
  });
});

describe("alertas operacionais", () => {
  const o = { limite: 3, silencioMin: 60 };
  it("avisa só ao chegar no limite e silencia por uma hora; zera ao se recuperar", () => {
    const T = 10_000_000_000;
    let e = atualizarFalhas(null, false, T, o);
    expect(e).toMatchObject({ falhas: 1, avisar: false });
    e = atualizarFalhas(e, false, T + 1, o);
    e = atualizarFalhas(e, false, T + 2, o);
    expect(e).toMatchObject({ falhas: 3, avisar: true, avisadoEm: T + 2 });
    const depois = atualizarFalhas(e, false, T + 10 * 60_000, o);
    expect(depois.avisar).toBe(false);
    const hora = atualizarFalhas(e, false, T + 61 * 60_000, o);
    expect(hora.avisar).toBe(true);
    const ok = atualizarFalhas(e, true, 5, o);
    expect(ok).toMatchObject({ falhas: 0, avisar: false, recuperou: true });
    expect(atualizarFalhas({ falhas: 1 }, true, 5, o).recuperou).toBe(false);
  });
  it("falhas espaçadas além da janela recomeçam a contagem", () => {
    const T = 10_000_000_000;
    const j = { limite: 3, silencioMin: 60, janelaMin: 30 };
    let e = atualizarFalhas(null, false, T, j);
    e = atualizarFalhas(e, false, T + 10 * 60_000, j);
    expect(e.falhas).toBe(2);
    e = atualizarFalhas(e, false, T + 100 * 60_000, j);
    expect(e).toMatchObject({ falhas: 1, avisar: false });
  });
  it("o texto do alerta omite telefones e não traz dados pessoais", () => {
    const t = textoAlerta("Evolution fora do ar", "falha ao enviar para 5511912345678 (HTTP 502)");
    expect(t.assunto).toBe("[MedCuidar] Evolution fora do ar");
    expect(t.corpo).not.toContain("5511912345678");
    expect(t.corpo).toContain("HTTP 502");
  });
});

describe("textoDoGemini", () => {
  it("lê o formato do nó nativo e o formato cru da API", async () => {
    const { textoDoGemini } = await import("./evolution");
    expect(textoDoGemini({ content: { parts: [{ text: " tomei  o remédio " }] } })).toBe("tomei o remédio");
    expect(textoDoGemini({ candidates: [{ content: { parts: [{ text: "ok" }] } }] })).toBe("ok");
    expect(textoDoGemini({ error: "x" })).toBe("");
    expect(textoDoGemini(null)).toBe("");
  });
});
