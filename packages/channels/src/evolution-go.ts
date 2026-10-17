import { randomUUID } from "node:crypto";
import { ChannelError, errorForStatus } from "./errors";
import { degradeContent, splitButtons, textWithCalls } from "./options";
import { destinationFor, normalizePhone } from "./phone";
import type {
  ChannelAdapter,
  InboundMessage,
  InboundType,
  MediaInput,
  OutboundButton,
  OutboundContent,
  SendResult,
} from "./types";

/**
 * Adaptador do Evolution Go (versão em Go da Evolution; NÃO é a Evolution API v2 em Node).
 * Rotas confirmadas no swagger oficial (EvolutionAPI/evolution-go) e em docs.evolutionfoundation.com.br/evolution-go:
 *   POST /send/text · /send/media · /send/button · /send/list · /message/downloadmedia
 *   cabeçalhos `apikey` (GLOBAL_API_KEY) e `instanceId` (UUID da instância)
 *   webhook: configurado em POST /instance/connect { webhookUrl, subscribe: ["MESSAGE"], immediate }.
 * Pontos ainda NÃO verificados com mensagem real estão marcados "TODO verificar com mensagem real".
 */
export interface EvolutionGoConfig {
  baseUrl: string;
  /** GLOBAL_API_KEY do Evolution Go. */
  apiKey: string;
  /** UUID da instância (cabeçalho `instanceId`). */
  instanceId: string;
  /** Botões interativos reais. Padrão false: opções numeradas em texto. */
  supportsButtons?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const pick = (o: Json, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return undefined;
};

// ───────────────────────── normalização isolada (testada por fixture) ─────────────────────────

/** Id da mensagem enviada. A doc é inconsistente (schema: `messageId`; exemplo: `data.Info.ID`). TODO verificar com mensagem real. */
export function extractSentMessageId(json: unknown): string | undefined {
  if (!isObj(json)) return undefined;
  const direct = pick(json, "messageId", "MessageID", "id", "ID");
  if (direct) return direct;
  const data = json["data"];
  if (isObj(data)) {
    const info = data["Info"];
    if (isObj(info)) return pick(info, "ID", "Id", "id");
    return pick(data, "messageId", "id", "ID");
  }
  return undefined;
}

/** Telefone do remetente a partir de `Info`. `Sender` pode vir como LID; `SenderAlt` traz o outro formato. TODO verificar com mensagem real (grupo e @lid). */
export function senderPhoneFromInfo(info: Json): string | null {
  const candidates = [str(info["Sender"]), str(info["SenderAlt"])].filter((x): x is string => !!x);
  const jid = candidates.find((c) => c.endsWith("@s.whatsapp.net")) ?? candidates.find((c) => !c.endsWith("@lid") && !c.endsWith("@g.us"));
  return jid ? normalizePhone(jid) : null;
}

/** Id do botão tocado. O whatsmeow serializa ora `...ID`, ora `...Id`. TODO verificar com mensagem real (modo botões). */
export function buttonIdFromMessage(message: Json): { id: string; text?: string } | null {
  const btn = message["buttonsResponseMessage"];
  if (isObj(btn)) {
    const id = pick(btn, "selectedButtonID", "selectedButtonId");
    if (id) return { id, ...(pick(btn, "selectedDisplayText") ? { text: pick(btn, "selectedDisplayText")! } : {}) };
  }
  const tpl = message["templateButtonReplyMessage"];
  if (isObj(tpl)) {
    const id = pick(tpl, "selectedID", "selectedId");
    if (id) return { id };
  }
  const list = message["listResponseMessage"];
  if (isObj(list) && isObj(list["singleSelectReply"])) {
    const id = pick(list["singleSelectReply"] as Json, "selectedRowID", "selectedRowId");
    if (id) return { id };
  }
  const inter = message["interactiveResponseMessage"];
  if (isObj(inter) && isObj(inter["nativeFlowResponseMessage"])) {
    const params = pick(inter["nativeFlowResponseMessage"] as Json, "paramsJSON", "paramsJson");
    try {
      const parsed: unknown = params ? JSON.parse(params) : null;
      const id = isObj(parsed) ? pick(parsed, "id") : undefined;
      if (id) return { id };
    } catch {
      /* ignora */
    }
  }
  return null;
}

/** Normaliza o `data` de um evento `Message` (Info + Message). */
export function normalizeEvolutionGoMessage(data: unknown): InboundMessage | null {
  if (!isObj(data) || !isObj(data["Info"])) return null;
  const info = data["Info"] as Json;
  if (info["IsFromMe"] === true) return null;
  const id = pick(info, "ID", "Id");
  const chat = str(info["Chat"]);
  if (!id || !chat) return null;
  const isGroup = info["IsGroup"] === true || chat.endsWith("@g.us");
  const from = senderPhoneFromInfo(info);
  if (!from) return null;

  const message = isObj(data["Message"]) ? (data["Message"] as Json) : {};
  const ts = Date.parse(str(info["Timestamp"]) ?? "");
  const receivedAt = Number.isNaN(ts) ? new Date() : new Date(ts);
  // Com WEBHOOK_FILES=true a mídia vem em `Message.base64`; com S3/MinIO, em `mediaUrl`. TODO verificar com mensagem real.
  const base64 = str(message["base64"]) ?? str(data["base64"]);
  const mediaUrl = str(data["mediaUrl"]) ?? str(message["mediaUrl"]);

  let type: InboundType | null = null;
  let text: string | undefined;
  let buttonId: string | undefined;
  let media: InboundMessage["media"];

  const button = buttonIdFromMessage(message);
  const ext = message["extendedTextMessage"];
  const audio = message["audioMessage"];
  const image = message["imageMessage"];
  const mediaRef = JSON.stringify(Object.fromEntries(Object.entries(message).filter(([k]) => k !== "base64")));

  if (button) {
    type = "button";
    buttonId = button.id;
    text = button.text;
  } else if (isObj(audio)) {
    type = "audio";
    media = { mimeType: str(audio["mimetype"]) ?? "audio/ogg", ref: mediaRef };
  } else if (isObj(image)) {
    type = "image";
    text = str(image["caption"]);
    media = { mimeType: str(image["mimetype"]) ?? "image/jpeg", ref: mediaRef };
  } else if (str(message["conversation"])) {
    type = "text";
    text = str(message["conversation"]);
  } else if (isObj(ext) && str(ext["text"])) {
    type = "text";
    text = str(ext["text"]);
  }
  if (!type) return null;
  if (media) {
    if (base64) media.base64 = base64;
    if (mediaUrl) media.url = mediaUrl;
  }

  const msg: InboundMessage = { providerMessageId: id, from, type, receivedAt };
  if (isGroup) msg.groupId = chat;
  if (text !== undefined) msg.text = text;
  if (buttonId !== undefined) msg.buttonId = buttonId;
  if (media) msg.media = media;
  return msg;
}

/** Resposta de `/message/downloadmedia`: formato não documentado. TODO verificar com mensagem real. */
export function extractDownloadedMedia(json: unknown): { base64: string; mimeType?: string } | null {
  if (!isObj(json)) return null;
  const inner = isObj(json["data"]) ? (json["data"] as Json) : json;
  const base64 = pick(inner, "base64", "Base64", "data");
  if (!base64) return null;
  const mimeType = pick(inner, "mimetype", "mimeType", "Mimetype");
  return { base64, ...(mimeType ? { mimeType } : {}) };
}

// ───────────────────────── adaptador ─────────────────────────

export class EvolutionGoAdapter implements ChannelAdapter {
  readonly name = "evolution-go";
  readonly supportsButtons: boolean;
  private readonly doFetch: typeof fetch;

  constructor(private readonly cfg: EvolutionGoConfig) {
    this.supportsButtons = cfg.supportsButtons ?? false;
    this.doFetch = cfg.fetch ?? fetch;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.cfg.baseUrl.replace(/\/$/, "")}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: this.cfg.apiKey, instanceId: this.cfg.instanceId },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch {
      throw new ChannelError("Evolution Go inacessível", true);
    }
    if (!res.ok) throw errorForStatus(res.status, "Evolution Go recusou a requisição");
    return res.json().catch(() => ({}));
  }

  /** Já enviado com sucesso: se o id não vier, não podemos falhar (reenvio duplicaria a mensagem). */
  private result(json: unknown): SendResult {
    return { providerMessageId: extractSentMessageId(json) ?? `evgo-${randomUUID()}` };
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    return this.result(await this.post("/send/text", { number: destinationFor(to), text }));
  }

  async sendButtons(to: string, content: { text: string; buttons: OutboundButton[] }): Promise<SendResult> {
    if (!this.supportsButtons) return this.sendText(to, degradeContent(content, false).text);
    const { replies } = splitButtons(content.buttons);
    if (replies.length === 0) return this.sendText(to, textWithCalls(content));
    return this.result(
      await this.post("/send/button", {
        number: destinationFor(to),
        title: "MedCuidar",
        description: textWithCalls(content), // `call` não pode ir junto de `reply`: vira linha de texto
        footer: "MedCuidar",
        buttons: replies.slice(0, 3).map((b) => ({ type: "reply", displayText: b.label, id: b.id })),
      }),
    );
  }

  async sendMedia(to: string, media: MediaInput): Promise<SendResult> {
    // TODO verificar com mensagem real: aceita data URI em `url`? Preferir URL assinada.
    const url = media.url ?? (media.base64 ? `data:${media.mimeType};base64,${media.base64}` : undefined);
    if (!url) throw new ChannelError("Mídia sem url nem base64", false);
    return this.result(
      await this.post("/send/media", {
        number: destinationFor(to),
        type: media.mimeType.startsWith("image/") ? "image" : "document",
        url,
        caption: media.caption ?? "",
        filename: media.fileName ?? (media.mimeType.startsWith("image/") ? "imagem.jpg" : "documento"),
      }),
    );
  }

  async sendToGroup(groupId: string, raw: OutboundContent): Promise<SendResult> {
    const content = degradeContent(raw, this.supportsButtons);
    if (content.media) return this.sendMedia(groupId, { ...content.media, caption: content.media.caption ?? content.text });
    if (content.buttons?.length) return this.sendButtons(groupId, { text: content.text, buttons: content.buttons });
    return this.sendText(groupId, content.text);
  }

  parseInbound(raw: unknown): InboundMessage[] {
    if (!isObj(raw) || str(raw["event"])?.toLowerCase() !== "message") return [];
    const msg = normalizeEvolutionGoMessage(raw["data"]);
    return msg ? [msg] : [];
  }

  async fetchMedia(message: InboundMessage): Promise<{ data: Uint8Array; mimeType: string }> {
    const media = message.media;
    if (!media) throw new ChannelError("Mensagem sem mídia", false);
    if (media.base64) return { data: Buffer.from(media.base64, "base64"), mimeType: media.mimeType };
    if (media.url) {
      let res: Response;
      try {
        res = await this.doFetch(media.url, { signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000) });
      } catch {
        throw new ChannelError("Mídia inacessível", true);
      }
      if (!res.ok) throw errorForStatus(res.status, "Falha ao baixar a mídia");
      return { data: new Uint8Array(await res.arrayBuffer()), mimeType: media.mimeType };
    }
    if (!media.ref) throw new ChannelError("Mídia sem referência", false);
    // TODO verificar com mensagem real: o corpo documentado é `{message:{conversation}}`; enviamos o objeto Message recebido.
    let messageObj: unknown;
    try {
      messageObj = JSON.parse(media.ref);
    } catch {
      throw new ChannelError("Referência de mídia inválida", false);
    }
    const out = extractDownloadedMedia(await this.post("/message/downloadmedia", { message: messageObj }));
    if (!out) throw new ChannelError("Evolution Go não devolveu a mídia", true);
    return { data: Buffer.from(out.base64, "base64"), mimeType: out.mimeType ?? media.mimeType };
  }
}
