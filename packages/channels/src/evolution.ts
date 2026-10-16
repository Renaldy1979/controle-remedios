import { ChannelError, errorForStatus } from "./errors";
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

export interface EvolutionConfig {
  baseUrl: string;
  apiKey: string;
  instance: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Adaptador da Evolution API v2. Toda a diferença para a API oficial da Meta fica aqui. */
export class EvolutionAdapter implements ChannelAdapter {
  readonly name = "evolution";
  private readonly doFetch: typeof fetch;

  constructor(private readonly cfg: EvolutionConfig) {
    this.doFetch = cfg.fetch ?? fetch;
  }

  private async post(path: string, body: unknown): Promise<Json> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, "")}${path}/${encodeURIComponent(this.cfg.instance)}`;
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: this.cfg.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch {
      // Rede, DNS, timeout: provedor inalcançável. Tentar de novo depois.
      throw new ChannelError("Evolution inacessível", true);
    }
    if (!res.ok) throw errorForStatus(res.status, "Evolution recusou o envio");
    const json: unknown = await res.json().catch(() => ({}));
    return isObj(json) ? json : {};
  }

  private idFrom(json: Json): SendResult {
    const key = json["key"];
    const id = isObj(key) ? str(key["id"]) : undefined;
    if (!id) throw new ChannelError("Evolution não devolveu o id da mensagem", true);
    return { providerMessageId: id };
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    return this.idFrom(await this.post("/message/sendText", { number: destinationFor(to), text }));
  }

  async sendButtons(to: string, content: { text: string; buttons: OutboundButton[] }): Promise<SendResult> {
    const buttons = content.buttons.slice(0, 3).map((b) =>
      b.kind === "call"
        ? { type: "call", displayText: b.label, phoneNumber: b.phone ?? "" }
        : { type: "reply", displayText: b.label, id: b.id },
    );
    return this.idFrom(
      await this.post("/message/sendButtons", {
        number: destinationFor(to),
        title: "MedCuidar",
        description: content.text,
        footer: "",
        buttons,
      }),
    );
  }

  async sendMedia(to: string, media: MediaInput): Promise<SendResult> {
    const source = media.url ?? media.base64;
    if (!source) throw new ChannelError("Mídia sem url nem base64", false);
    const mediatype = media.mimeType.startsWith("image/") ? "image" : "document";
    return this.idFrom(
      await this.post("/message/sendMedia", {
        number: destinationFor(to),
        mediatype,
        mimetype: media.mimeType,
        caption: media.caption ?? "",
        media: source,
        fileName: media.fileName ?? (mediatype === "image" ? "imagem.jpg" : "documento"),
      }),
    );
  }

  async sendToGroup(groupId: string, content: OutboundContent): Promise<SendResult> {
    if (content.media) return this.sendMedia(groupId, { ...content.media, caption: content.media.caption ?? content.text });
    if (content.buttons?.length) return this.sendButtons(groupId, { text: content.text, buttons: content.buttons });
    return this.sendText(groupId, content.text);
  }

  parseInbound(raw: unknown): InboundMessage[] {
    if (!isObj(raw)) return [];
    const event = str(raw["event"])?.toLowerCase().replace(/_/g, ".");
    if (event && event !== "messages.upsert") return [];
    const data = raw["data"];
    const items = Array.isArray(data) ? data : [data];
    const out: InboundMessage[] = [];
    for (const item of items) {
      const msg = this.parseOne(item);
      if (msg) out.push(msg);
    }
    return out;
  }

  private parseOne(item: unknown): InboundMessage | null {
    if (!isObj(item)) return null;
    const key = item["key"];
    if (!isObj(key) || key["fromMe"] === true) return null;
    const id = str(key["id"]);
    const remoteJid = str(key["remoteJid"]);
    if (!id || !remoteJid) return null;

    const isGroup = remoteJid.endsWith("@g.us");
    // Versões novas usam @lid; o telefone real vem em campos alternativos.
    const senderJid = isGroup
      ? (str(key["participantPn"]) ?? str(key["participant"]))
      : remoteJid.endsWith("@lid")
        ? (str(key["senderPn"]) ?? str(key["remoteJidAlt"]) ?? str(item["senderPn"]))
        : remoteJid;
    if (!senderJid || senderJid.endsWith("@lid")) return null;
    const from = normalizePhone(senderJid);
    if (!from) return null;

    const message = isObj(item["message"]) ? (item["message"] as Json) : {};
    const ts = Number(item["messageTimestamp"]);
    const receivedAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date();

    let type: InboundType | null = null;
    let text: string | undefined;
    let buttonId: string | undefined;
    let media: InboundMessage["media"];

    const ext = message["extendedTextMessage"];
    const btn = message["buttonsResponseMessage"];
    const tpl = message["templateButtonReplyMessage"];
    const list = message["listResponseMessage"];
    const inter = message["interactiveResponseMessage"];
    const audio = message["audioMessage"];
    const image = message["imageMessage"];
    const inlineB64 = str(message["base64"]) ?? str(item["base64"]);

    if (isObj(btn) && str(btn["selectedButtonId"])) {
      type = "button";
      buttonId = str(btn["selectedButtonId"]);
      text = str(btn["selectedDisplayText"]);
    } else if (isObj(tpl) && str(tpl["selectedId"])) {
      type = "button";
      buttonId = str(tpl["selectedId"]);
      text = str(tpl["selectedDisplayText"]);
    } else if (isObj(list) && isObj(list["singleSelectReply"]) && str((list["singleSelectReply"] as Json)["selectedRowId"])) {
      type = "button";
      buttonId = str((list["singleSelectReply"] as Json)["selectedRowId"]);
    } else if (isObj(inter)) {
      const nf = inter["nativeFlowResponseMessage"];
      const params = isObj(nf) ? str(nf["paramsJson"]) : undefined;
      try {
        const parsed: unknown = params ? JSON.parse(params) : null;
        const pid = isObj(parsed) ? str(parsed["id"]) : undefined;
        if (pid) {
          type = "button";
          buttonId = pid;
        }
      } catch {
        /* ignora payload inválido */
      }
    } else if (isObj(audio)) {
      type = "audio";
      media = { mimeType: str(audio["mimetype"]) ?? "audio/ogg", ref: id };
      if (inlineB64) media.base64 = inlineB64;
    } else if (isObj(image)) {
      type = "image";
      text = str(image["caption"]);
      media = { mimeType: str(image["mimetype"]) ?? "image/jpeg", ref: id };
      if (inlineB64) media.base64 = inlineB64;
    } else if (str(message["conversation"])) {
      type = "text";
      text = str(message["conversation"]);
    } else if (isObj(ext) && str(ext["text"])) {
      type = "text";
      text = str(ext["text"]);
    }
    if (!type) return null;

    const msg: InboundMessage = { providerMessageId: id, from, type, receivedAt };
    if (isGroup) msg.groupId = remoteJid;
    if (text !== undefined) msg.text = text;
    if (buttonId !== undefined) msg.buttonId = buttonId;
    if (media) msg.media = media;
    return msg;
  }

  async fetchMedia(message: InboundMessage): Promise<{ data: Uint8Array; mimeType: string }> {
    const media = message.media;
    if (!media) throw new ChannelError("Mensagem sem mídia", false);
    if (media.base64) return { data: Buffer.from(media.base64, "base64"), mimeType: media.mimeType };
    if (!media.ref) throw new ChannelError("Mídia sem referência", false);
    const json = await this.post("/chat/getBase64FromMediaMessage", {
      message: { key: { id: media.ref } },
      convertToMp4: false,
    });
    const b64 = str(json["base64"]);
    if (!b64) throw new ChannelError("Evolution não devolveu a mídia", true);
    return { data: Buffer.from(b64, "base64"), mimeType: str(json["mimetype"]) ?? media.mimeType };
  }
}
