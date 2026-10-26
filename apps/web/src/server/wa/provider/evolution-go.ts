import { ErroEnvio, type MensagemRecebida, type ProvedorWhatsapp, type ResultadoParse } from "./types";
import { soDigitos, telefoneBr } from "./telefone";

/**
 * Provedor Evolution Go (cliente não oficial do WhatsApp). É o ÚNICO lugar do portal que conhece o formato da Evolution:
 * payload do webhook (Info/Message), envio (`POST /send/text`), presença (`POST /message/presence`), estado (`GET /instance/status`)
 * e download de mídia (`POST /message/downloadmedia`). Referência: docs/handoffs/D-para-orquestrador-evolution-go.md.
 * Onde o formato real ainda é dúvida, a função é pequena e marcada `TODO verificar com mensagem real`, com teste por fixture
 * (`fixtures/eventos.json`). Autenticação (TODO verificar com mensagem real: a doc oficial só diz que o `apikey` pode ser a chave global OU a da instância, e que 401 = chave inválida/ausente): as rotas da INSTÂNCIA (/send, /message, /user, /instance/status) levam no `apikey` o TOKEN DA INSTÂNCIA (`instanceToken`, com fallback para a chave global `apiKey`); a chave global fica para rotas administrativas. O cabeçalho `instanceId` segue sendo enviado (inofensivo se não for usado).
 */
export interface ConfigEvolutionGo {
  /** endereço da Evolution Go, sem barra final */
  baseUrl: string;
  /** chave GLOBAL da Evolution Go (rotas administrativas; fallback das rotas da instância) */
  apiKey: string;
  /** token da INSTÂNCIA (rotas /send, /message, /user, /instance/status). Sem ele, usa `apiKey`. */
  instanceToken?: string;
  instanceId: string;
  fetchFn?: typeof fetch;
}

const MAX_FOTO_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_SEG = 180;
const MIMES_IMAGEM = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
/** Ações que o núcleo da conversa entende quando o id do botão é uma delas. */
export const ACOES_VALIDAS = ["tomei", "lembrar", "cuido", "estoque", "proximas", "ajuda"];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Json => (isObj(v) ? v : {});
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const pick = (o: Json, ...keys: string[]): string => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return "";
};
const limpaMime = (m: unknown) => str(m).split(";")[0]!.trim().toLowerCase();
const ehUsuario = (j: string) => /^[0-9:.]+@(s\.whatsapp\.net|c\.us)$/.test(j);
const temMidia = (o: unknown) => isObj(o) && Object.values(o).some((v) => v !== undefined && v !== null && v !== "");

/** Telefone (só dígitos) de um JID de contato; `@lid`, grupo, broadcast e newsletter não são telefone. TODO verificar com mensagem real (@lid). */
export function telefoneDoJid(jid: unknown): string {
  const s = str(jid);
  if (!ehUsuario(s)) return "";
  const d = soDigitos(s.split("@")[0]!.split(":")[0]!.split(".")[0]);
  return d.length >= 10 && d.length <= 15 ? d : "";
}

/** Remetente real de uma conversa 1:1: `Sender`, depois `SenderAlt`, por último `Chat`. TODO verificar com mensagem real. */
export function remetenteDoInfo(info: Json): string {
  for (const k of ["Sender", "SenderAlt"]) {
    const t = telefoneDoJid(info[k]);
    if (t) return t;
  }
  return telefoneDoJid(info["Chat"]);
}

/** Id do botão/linha tocado: o whatsmeow serializa ora `...ID`, ora `...Id`. TODO verificar com mensagem real (só com botões ligados). */
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

/** Id da mensagem enviada: a doc é inconsistente (`messageId` no schema, `data.Info.ID` no exemplo). TODO verificar com mensagem real. */
export function idDaMensagemEnviada(resp: unknown): string {
  if (!isObj(resp)) return "";
  const direto = pick(resp, "messageId", "MessageID", "id", "ID");
  if (direto) return direto;
  const data = resp["data"];
  if (isObj(data)) {
    if (isObj(data["Info"])) return pick(data["Info"] as Json, "ID", "Id", "id");
    return pick(data, "messageId", "id", "ID");
  }
  return "";
}

/** O envio deu certo? 2xx com corpo que não diz `error`. Sem id no corpo continua sendo sucesso (já foi enviado; falhar duplicaria). */
export function envioOk(status: number, corpo: unknown): boolean {
  if (!(status >= 200 && status < 300)) return false;
  return !(isObj(corpo) && (corpo["error"] || corpo["Error"]));
}

/** Resposta de `/message/downloadmedia`: formato não documentado. TODO verificar com mensagem real. */
export function midiaBaixada(resp: unknown): { base64: string; mimetype: string } | null {
  if (!isObj(resp)) return null;
  const dentro = isObj(resp["data"]) ? (resp["data"] as Json) : resp;
  const base64 = pick(dentro, "base64", "Base64", "data");
  return base64 ? { base64, mimetype: pick(dentro, "mimetype", "mimeType", "Mimetype") } : null;
}

/** Estado da instância: aceita `Connected/LoggedIn` ou `state/status`. TODO verificar com mensagem real. */
export function conectadaDe(corpo: unknown): boolean | null {
  const j = obj(corpo);
  const d = obj(j["data"] ?? j);
  const c = d["Connected"] ?? d["connected"] ?? d["isConnected"];
  const l = d["LoggedIn"] ?? d["loggedIn"] ?? d["isLoggedIn"];
  if (typeof c === "boolean" || typeof l === "boolean") return c !== false && l !== false;
  const est = d["state"] ?? d["status"];
  if (typeof est === "string") return /^(open|connected|online)$/i.test(est);
  return null;
}

/**
 * Resposta de `POST /user/check` ("este número está no WhatsApp?"). TODO verificar com mensagem real: formato presumido pela doc da
 * Evolution Go: lista de `{ Query, IsInWhatsapp, JID }`, às vezes dentro de `data`. Devolve null se o formato não for reconhecido.
 */
export function respostaUserCheck(resp: unknown): { existe: boolean; numero: string } | null {
  const j = obj(resp);
  const d = j["data"] ?? j["Data"] ?? resp;
  const item = obj(Array.isArray(d) ? d[0] : (isObj(d) && Array.isArray(d["Users"] ?? d["users"]) ? ((d["Users"] ?? d["users"]) as unknown[])[0] : d));
  const existe = item["IsInWhatsapp"] ?? item["isInWhatsapp"] ?? item["exists"] ?? item["Exists"];
  if (typeof existe !== "boolean") return null;
  const jid = pick(item, "JID", "Jid", "jid");
  const numero = jid ? telefoneDoJid(jid) || soDigitos(jid.split("@")[0]!.split(":")[0]) : "";
  return { existe, numero: numero || soDigitos(pick(item, "Query", "query", "number")) };
}

/** O envio falhou porque o número não existe no WhatsApp? TODO verificar com mensagem real (texto do erro). */
export function erroNumeroInexistente(status: number, corpo: unknown): boolean {
  if (status < 400 || status >= 500) return false;
  const t = JSON.stringify(corpo ?? "").toLowerCase();
  return /not (on|in|registered)|n[uú]mero.{0,20}(inexist|n[aã]o)|invalid (number|jid)|no account|not exist|exists/.test(t) && /whatsapp|number|jid|n[uú]mero/.test(t);
}

/** Texto que aparece no painel e no log (sem segredo) quando a Evolution recusa a chave. */
export const MSG_CHAVE_RECUSADA = (status: number): string =>
  `Evolution recusou a chave (${status}): use o token da instância em EVOLUTION_INSTANCE_TOKEN (Evolution Go › instância › token)`;

export function criarEvolutionGo(cfg: ConfigEvolutionGo): ProvedorWhatsapp {
  const f = cfg.fetchFn ?? fetch;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const chaveDaInstancia = (cfg.instanceToken ?? "").trim() || cfg.apiKey;
  const cabecalhos = { "content-type": "application/json", apikey: chaveDaInstancia, instanceId: cfg.instanceId };
  const chamar = (caminho: string, init: RequestInit, timeoutMs: number) =>
    f(base + caminho, { ...init, headers: cabecalhos, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });

  return {
    id: "evolution-go",

    parseWebhook(corpo): ResultadoParse {
      const raiz = obj(corpo);
      const evento = str(raiz["event"] ?? raiz["Event"] ?? raiz["type"]).toLowerCase().replace(/[._]/g, "");
      if (evento !== "message" && evento !== "messagesupsert") return { ignorar: "evento" };
      // instância diferente da configurada: ignora. Payload sem `instanceId` passa (a proteção é o segredo do caminho). TODO verificar com mensagem real.
      const inst = str(raiz["instanceId"] ?? raiz["instance_id"]).toLowerCase();
      if (inst && cfg.instanceId.trim() && inst !== cfg.instanceId.trim().toLowerCase()) return { ignorar: "instancia" };
      const data = obj(raiz["data"]);
      if (!isObj(data["Info"])) return { ignorar: "sem_info" };
      const info = obj(data["Info"]);
      const chat = str(info["Chat"]);
      if (info["IsFromMe"] === true || info["IsFromMe"] === "true") return { ignorar: "propria" };
      if (info["IsGroup"] === true || info["IsGroup"] === "true" || /@g\.us$/.test(chat)) return { ignorar: "grupo" };
      if (chat.startsWith("status@") || /@(broadcast|newsletter)$/.test(chat)) return { ignorar: "status" };
      const msgId = pick(info, "ID", "Id").replace(/[^\x21-\x7e]/g, "").slice(0, 120);
      if (!msgId) return { ignorar: "sem_id" };
      const remetente = remetenteDoInfo(info);
      if (!remetente) return { ignorar: "sem_telefone" };

      let idadeSegundos: number | null = null;
      const ts = Date.parse(str(info["Timestamp"]));
      if (!Number.isNaN(ts)) idadeSegundos = Math.max(0, Math.round((Date.now() - ts) / 1000));

      const msg0 = obj(data["Message"]);
      const m = obj(obj(msg0["ephemeralMessage"])["message"] ?? obj(msg0["viewOnceMessage"])["message"] ?? msg0);
      // Com WEBHOOK_FILES=true a mídia vem em Message.base64; senão há que baixar. TODO verificar com mensagem real.
      const base64 = str(msg0["base64"] ?? m["base64"] ?? data["base64"]);
      const bytes = Math.floor((base64.length * 3) / 4);
      const semBase64 = Object.fromEntries(Object.entries(msg0).filter(([k]) => k !== "base64"));
      const base: MensagemRecebida = {
        msgId, telefone: telefoneBr(remetente), numeroResposta: remetente, tipo: "outro", texto: "", acao: "", aviso: "", mime: "",
        base64: "", segundos: 0, midiaRef: null, idadeSegundos,
      };

      const botao = respostaDeBotao(m);
      if (botao) {
        const acao = ACOES_VALIDAS.includes(botao.id) ? botao.id : "";
        return { mensagem: { ...base, tipo: "botao", acao, texto: acao ? "" : (botao.texto || botao.id).slice(0, 2000) } };
      }
      const img = m["imageMessage"], aud = m["audioMessage"];
      if (temMidia(img)) {
        const i = img as Json;
        const mime = MIMES_IMAGEM.includes(limpaMime(i["mimetype"])) ? limpaMime(i["mimetype"]) : "image/jpeg";
        const r: MensagemRecebida = { ...base, tipo: "imagem", mime, texto: str(i["caption"]).trim().slice(0, 2000), base64, midiaRef: base64 ? null : semBase64 };
        if (Math.max(Number(i["fileLength"]) || 0, bytes) > MAX_FOTO_BYTES) return { mensagem: { ...r, tipo: "recusa", base64: "", midiaRef: null, aviso: "foto_grande" } };
        return { mensagem: r };
      }
      if (temMidia(aud)) {
        const a = aud as Json;
        const mime = limpaMime(a["mimetype"]).startsWith("audio/") ? limpaMime(a["mimetype"]) : "audio/ogg";
        const segundos = Math.max(Number(a["seconds"]) || 0, 0);
        const r: MensagemRecebida = { ...base, tipo: "audio", mime, segundos, base64, midiaRef: base64 ? null : semBase64 };
        if (segundos > MAX_AUDIO_SEG) return { mensagem: { ...r, tipo: "recusa", base64: "", midiaRef: null, aviso: "audio_longo" } };
        return { mensagem: r };
      }
      const ext = m["extendedTextMessage"];
      const texto = (str(m["conversation"]) || (isObj(ext) ? str(ext["text"]) : "")).trim().slice(0, 2000);
      if (texto) return { mensagem: { ...base, tipo: "texto", texto } };
      return { mensagem: { ...base, tipo: "outro" } };
    },

    async enviarTexto(numero, texto) {
      let r: Response;
      try {
        r = await chamar("/send/text", { method: "POST", body: JSON.stringify({ number: soDigitos(numero), text: texto }) }, 15000);
      } catch (e) {
        // sem resposta (timeout/rede): ambíguo, a mensagem pode ter saído
        throw new ErroEnvio(`rede: ${e instanceof Error ? e.name : "erro"}`, false);
      }
      const corpo = await r.json().catch(() => null);
      if (r.status === 401 || r.status === 403) throw new ErroEnvio(MSG_CHAVE_RECUSADA(r.status), true, false, true);
      if (!envioOk(r.status, corpo)) throw new ErroEnvio(`Evolution /send/text respondeu ${r.status}`, r.status >= 400 && r.status < 500, erroNumeroInexistente(r.status, corpo));
      return { messageId: idDaMensagemEnviada(corpo) || `sint-${Date.now()}` };
    },

    async presenca(numero) {
      const r = await chamar("/message/presence", { method: "POST", body: JSON.stringify({ number: soDigitos(numero), state: "composing", isAudio: false }) }, 5000);
      if (r.status < 200 || r.status >= 300) throw new Error(`Evolution presença respondeu ${r.status}`);
    },

    async statusInstancia() {
      const r = await chamar("/instance/status", { method: "GET" }, 10000);
      if (r.status === 401 || r.status === 403) return { conectada: null }; // chave recusada: não sabemos o estado (não é "desconectada")
      if (r.status !== 200) return { conectada: false };
      return { conectada: conectadaDe(await r.json().catch(() => null)) };
    },

    async numeroNoWhatsapp(numero) {
      // TODO verificar com mensagem real: rota e corpo de "verificar usuário" da Evolution Go (`POST /user/check`)
      try {
        const r = await chamar("/user/check", { method: "POST", body: JSON.stringify({ number: [soDigitos(numero)], formatJid: true }) }, 10000);
        if (r.status !== 200) return null;
        return respostaUserCheck(await r.json().catch(() => null));
      } catch {
        return null;
      }
    },

    async baixarMidia(ref) {
      // TODO verificar com mensagem real: a doc mostra `{message:{conversation}}`; enviamos o objeto Message recebido.
      try {
        const r = await chamar("/message/downloadmedia", { method: "POST", body: JSON.stringify({ message: ref }) }, 30000);
        if (r.status !== 200) return null;
        return midiaBaixada(await r.json().catch(() => null));
      } catch {
        return null;
      }
    },
  };
}
