/**
 * Normalização do webhook da Evolution Go e montagem das chamadas de envio. Módulo PURO (sem imports, sem I/O):
 * o `pnpm n8n:build` embute este mesmo código nos nós "Code" dos fluxos, então o que os testes cobrem é o que roda no N8N.
 * Formato de referência: docs/handoffs/D-para-orquestrador-evolution-go.md. Onde o formato real é dúvida, a função é
 * pequena e marcada "TODO verificar com mensagem real" (use o fluxo 00-captura para conferir).
 */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const pick = (o: Json, ...keys: string[]): string => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return "";
};

export const soDigitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/**
 * Telefone (só dígitos) de um JID de contato. `5511912345678@s.whatsapp.net` e `5511912345678:12@s.whatsapp.net` (aparelho)
 * valem; `@lid` (identificador oculto), grupo, broadcast e newsletter não são telefone. TODO verificar com mensagem real (@lid).
 */
export function telefoneDoJid(jid: unknown): string {
  const s = str(jid);
  if (!s.endsWith("@s.whatsapp.net")) return "";
  const d = soDigitos(s.split("@")[0]!.split(":")[0]);
  return d.length >= 10 && d.length <= 15 ? d : "";
}

/** Remetente real de uma conversa 1:1. Prefere `Sender`; cai para `SenderAlt` e, por último, `Chat` (conversa privada). TODO verificar com mensagem real. */
export function remetenteDoInfo(info: Json): string {
  for (const k of ["Sender", "SenderAlt"]) {
    const t = telefoneDoJid(info[k]);
    if (t) return t;
  }
  return telefoneDoJid(info["Chat"]);
}

/** Id do botão/linha tocado. O whatsmeow serializa ora `...ID`, ora `...Id`. TODO verificar com mensagem real (só com botões ligados). */
export function respostaDeBotao(message: Json): { id: string; texto: string } | null {
  const btn = message["buttonsResponseMessage"];
  if (isObj(btn)) {
    const id = pick(btn, "selectedButtonID", "selectedButtonId");
    if (id) return { id, texto: pick(btn, "selectedDisplayText") };
  }
  const tpl = message["templateButtonReplyMessage"];
  if (isObj(tpl)) {
    const id = pick(tpl, "selectedID", "selectedId");
    if (id) return { id, texto: pick(tpl, "selectedDisplayText") };
  }
  const list = message["listResponseMessage"];
  if (isObj(list) && isObj(list["singleSelectReply"])) {
    const id = pick(list["singleSelectReply"] as Json, "selectedRowID", "selectedRowId");
    if (id) return { id, texto: pick(list, "title") };
  }
  return null;
}

/** Ações que a API aceita no lugar do texto (`POST /conversa/mensagem`). */
export const ACOES_VALIDAS = ["tomei", "lembrar", "cuido", "estoque", "proximas", "ajuda"];

export interface EntradaNormalizada {
  /** processar = chamar a API; ignorar = fim do fluxo, sem resposta */
  acao: "processar" | "ignorar";
  /** motivo da decisão (nunca contém dados pessoais) */
  motivo: string;
  telefone: string;
  messageId: string;
  /** texto | audio | botao | imagem */
  tipo: string;
  texto: string;
  /** só botão: ação da API quando o id do botão é uma delas */
  acaoApi: string;
  /** só áudio */
  midia: { mimetype: string; base64: string; url: string; message: Json } | null;
  /** segundos desde o envio (para descartar backlog antigo) */
  idadeSegundos: number | null;
}

const ignorar = (motivo: string, extra: Partial<EntradaNormalizada> = {}): EntradaNormalizada => ({
  acao: "ignorar", motivo, telefone: "", messageId: "", tipo: "", texto: "", acaoApi: "", midia: null, idadeSegundos: null, ...extra,
});

/** O webhook do N8N entrega `{ headers, query, body }`; o simulador e os testes mandam o corpo direto. */
export function corpoDoWebhook(entrada: unknown): Json {
  if (!isObj(entrada)) return {};
  const corpo = entrada["body"];
  return isObj(corpo) && ("event" in corpo || "data" in corpo) ? corpo : entrada;
}

/**
 * Decide o que fazer com um evento da Evolution Go. Ignora: eventos que não são mensagem, mensagens enviadas por nós (`IsFromMe`),
 * grupos, status/broadcast/newsletter, mensagens sem remetente com telefone e mensagens antigas demais (backlog).
 * Nunca lança erro: payload estranho vira "ignorar".
 */
export function normalizarEvento(entrada: unknown, opcoes: { agoraMs?: number; idadeMaximaMin?: number } = {}): EntradaNormalizada {
  const raiz = corpoDoWebhook(entrada);
  const evento = str(raiz["event"]) || str(raiz["Event"]) || str(raiz["type"]);
  if (evento.toLowerCase() !== "message") return ignorar("nao_e_mensagem");
  const data = raiz["data"];
  if (!isObj(data) || !isObj(data["Info"])) return ignorar("sem_info");
  const info = data["Info"] as Json;
  const chat = str(info["Chat"]);

  if (info["IsFromMe"] === true) return ignorar("enviada_por_nos");
  if (info["IsGroup"] === true || chat.endsWith("@g.us")) return ignorar("grupo");
  if (chat.startsWith("status@") || chat.endsWith("@broadcast") || chat.endsWith("@newsletter")) return ignorar("status_ou_broadcast");

  const messageId = pick(info, "ID", "Id");
  if (!messageId) return ignorar("sem_id");
  const telefone = remetenteDoInfo(info);
  if (!telefone) return ignorar("sem_telefone");

  let idadeSegundos: number | null = null;
  const ts = Date.parse(str(info["Timestamp"]));
  if (!Number.isNaN(ts)) {
    idadeSegundos = Math.max(0, Math.round(((opcoes.agoraMs ?? Date.now()) - ts) / 1000));
    if (idadeSegundos > (opcoes.idadeMaximaMin ?? 60) * 60) return ignorar("antiga", { telefone, messageId, idadeSegundos });
  }

  const message = isObj(data["Message"]) ? (data["Message"] as Json) : {};
  // Com WEBHOOK_FILES=true a mídia vem em Message.base64; com armazenamento externo, em mediaUrl. TODO verificar com mensagem real.
  const base64 = str(message["base64"]) || str(data["base64"]);
  const url = str(data["mediaUrl"]) || str(message["mediaUrl"]);
  const semBase64 = Object.fromEntries(Object.entries(message).filter(([k]) => k !== "base64"));
  const base = { telefone, messageId, idadeSegundos, acaoApi: "", midia: null as EntradaNormalizada["midia"] };

  const botao = respostaDeBotao(message);
  if (botao) {
    const acaoApi = ACOES_VALIDAS.includes(botao.id) ? botao.id : "";
    return { ...base, acao: "processar", motivo: "botao", tipo: "botao", texto: acaoApi ? "" : botao.texto || botao.id, acaoApi };
  }
  const audio = message["audioMessage"];
  if (isObj(audio)) {
    return { ...base, acao: "processar", motivo: "audio", tipo: "audio", texto: "", midia: { mimetype: pick(audio, "mimetype", "mimeType") || "audio/ogg", base64, url, message: semBase64 } };
  }
  const imagem = message["imageMessage"];
  if (isObj(imagem)) {
    // imagem não é entendida pela conversa em código: segue como texto da legenda (vazio → resposta de ajuda da API)
    return { ...base, acao: "processar", motivo: "imagem", tipo: "imagem", texto: pick(imagem, "caption") };
  }
  const ext = message["extendedTextMessage"];
  const texto = str(message["conversation"]) || (isObj(ext) ? str(ext["text"]) : "");
  if (texto) return { ...base, acao: "processar", motivo: "texto", tipo: "texto", texto };
  return ignorar("tipo_nao_suportado", { telefone, messageId, idadeSegundos });
}

/** Idempotency-Key do `POST /conversa/mensagem`: derivada do id da mensagem (o mesmo id repetido devolve a mesma resposta). */
export const chaveIdempotencia = (messageId: string): string => `evo-${messageId}`.slice(0, 120);

/** Corpo do `POST /conversa/mensagem`. `texto` e `acao` são excludentes; o telefone NÃO vai no corpo (vai em X-Telefone). */
export function corpoConversa(e: { messageId: string; texto: string; acaoApi: string }, textoTranscrito?: string): Json {
  if (e.acaoApi) return { messageId: e.messageId, acao: e.acaoApi };
  return { messageId: e.messageId, texto: (textoTranscrito ?? e.texto).slice(0, 2000) };
}

/** Texto transcrito vazio ou só ruído: não vale mandar à API. */
export const transcricaoUtil = (t: unknown): string => {
  const s = str(t).trim();
  return s.length >= 2 ? s : "";
};

/** Resposta da API (`dados`) → envios `/send/text`. `intent: "livre"` (ou nenhuma resposta) = chamar o agente. */
export function planejarRespostas(dados: unknown, telefone: string): { livre: boolean; envios: Array<{ number: string; text: string }> } {
  const d = isObj(dados) ? dados : {};
  const respostas = Array.isArray(d["respostas"]) ? (d["respostas"] as unknown[]) : [];
  const envios = respostas
    .map((r) => (isObj(r) ? str(r["texto"]) : ""))
    .filter((t) => t.length > 0)
    .map((text) => ({ number: soDigitos(telefone), text }));
  return { livre: str(d["intent"]) === "livre", envios };
}

/** Corpo do `POST {evolution}/send/text`. Só dígitos no número (a Evolution Go monta o JID). */
export const corpoEnvioTexto = (telefone: string, texto: string): Json => ({ number: soDigitos(telefone), text: texto });

/** Id da mensagem enviada. A doc é inconsistente (`messageId` no schema, `data.Info.ID` no exemplo). TODO verificar com mensagem real. */
export function idDaMensagemEnviada(resp: unknown): string {
  if (!isObj(resp)) return "";
  const direto = pick(resp, "messageId", "MessageID", "id", "ID");
  if (direto) return direto;
  const data = resp["data"];
  if (isObj(data)) {
    const info = data["Info"];
    if (isObj(info)) return pick(info, "ID", "Id", "id");
    return pick(data, "messageId", "id", "ID");
  }
  return "";
}

/** O envio deu certo? 2xx com corpo que não diz `error`. Sem id no corpo continua sendo sucesso (já foi enviado; falhar duplicaria). */
export function envioOk(statusCode: unknown, corpo: unknown): boolean {
  const s = Number(statusCode);
  if (!(s >= 200 && s < 300)) return false;
  if (isObj(corpo) && (corpo["error"] || corpo["Error"])) return false;
  return true;
}

/** Corpo do `POST {evolution}/message/downloadmedia`. TODO verificar com mensagem real: a doc mostra `{message:{conversation}}`; enviamos o objeto Message recebido. */
export const corpoBaixarMidia = (message: Json): Json => ({ message });

/** Resposta de `/message/downloadmedia`: formato não documentado. TODO verificar com mensagem real. */
export function midiaBaixada(resp: unknown): { base64: string; mimetype: string } | null {
  if (!isObj(resp)) return null;
  const dentro = isObj(resp["data"]) ? (resp["data"] as Json) : resp;
  const base64 = pick(dentro, "base64", "Base64", "data");
  if (!base64) return null;
  return { base64, mimetype: pick(dentro, "mimetype", "mimeType", "Mimetype") };
}

/** Limita a rajada de lembretes (anti-bloqueio): no máximo `max` por ciclo; o resto volta no próximo (a API reenvia pelo lease). */
export function limitarRajada<T>(itens: T[], max: number): { enviar: T[]; adiados: T[] } {
  const n = Math.max(0, Math.floor(max));
  return { enviar: itens.slice(0, n), adiados: itens.slice(n) };
}

export interface LembretePendente { id: string; telefone: string; texto: string; tipo: string }

/** `GET /lembretes/pendentes` (e /avisos/*) → itens válidos. Descarta o que não tem id, telefone de dígitos ou texto. */
export function lembretesParaEnviar(dados: unknown): LembretePendente[] {
  const d = isObj(dados) ? dados : {};
  const lista = Array.isArray(d["mensagens"]) ? (d["mensagens"] as unknown[]) : [];
  const out: LembretePendente[] = [];
  for (const m of lista) {
    if (!isObj(m)) continue;
    const telefone = soDigitos(m["telefone"]);
    const id = str(m["id"]);
    const texto = str(m["texto"]);
    if (id && telefone.length >= 10 && texto) out.push({ id, telefone, texto, tipo: str(m["tipo"]) });
  }
  return out;
}

/**
 * Contador de falhas seguidas (06-alertas): zera no primeiro sucesso; falhas separadas por mais de `janelaMin` recomeçam a contagem;
 * avisa ao chegar no limite e no máximo uma vez por `silencioMin`.
 */
export function atualizarFalhas(
  anterior: { falhas?: number; avisadoEm?: number; ultimaEm?: number } | null | undefined,
  ok: boolean,
  agoraMs: number,
  opcoes: { limite: number; silencioMin: number; janelaMin?: number },
): { falhas: number; avisadoEm: number; ultimaEm: number; avisar: boolean; recuperou: boolean } {
  const falhasAntes = Math.max(0, Number(anterior?.falhas) || 0);
  const avisadoAntes = Number(anterior?.avisadoEm) || 0;
  if (ok) return { falhas: 0, avisadoEm: 0, ultimaEm: 0, avisar: false, recuperou: falhasAntes >= opcoes.limite && avisadoAntes > 0 };
  const ultimaAntes = Number(anterior?.ultimaEm) || 0;
  const velha = opcoes.janelaMin !== undefined && ultimaAntes > 0 && agoraMs - ultimaAntes > opcoes.janelaMin * 60_000;
  const falhas = (velha ? 0 : falhasAntes) + 1;
  const podeAvisar = falhas >= opcoes.limite && agoraMs - avisadoAntes >= opcoes.silencioMin * 60_000;
  return { falhas, avisadoEm: podeAvisar ? agoraMs : avisadoAntes, ultimaEm: agoraMs, avisar: podeAvisar, recuperou: false };
}

/** Assunto/corpo do e-mail de alerta: nunca leva telefone, nome ou texto de mensagem. */
export function textoAlerta(motivo: string, detalhe: string): { assunto: string; corpo: string } {
  const limpo = detalhe.replace(/\d{8,}/g, "[número omitido]").slice(0, 300);
  return {
    assunto: `[MedCuidar] ${motivo}`,
    corpo: `${motivo}\n\n${limpo}\n\nAbra o N8N › Executions para ver o detalhe. Esta mensagem não contém dados pessoais.`,
  };
}

/** Texto da resposta do nó Google Gemini (transcrição). O nó nativo devolve `content.parts[].text`; aceita também o formato cru da API. */
export function textoDoGemini(r: unknown): string {
  if (!isObj(r)) return "";
  const partes = (c: unknown): string => {
    if (!isObj(c) || !Array.isArray(c["parts"])) return "";
    return (c["parts"] as unknown[]).map((p) => (isObj(p) ? str(p["text"]) : "")).join(" ").replace(/\s+/g, " ").trim();
  };
  const direto = partes(r["content"]);
  if (direto) return direto;
  const cand = Array.isArray(r["candidates"]) ? (r["candidates"] as unknown[])[0] : null;
  return isObj(cand) ? partes(cand["content"]) : str(r["text"]).trim();
}
