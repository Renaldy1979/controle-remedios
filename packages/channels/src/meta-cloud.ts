import { ChannelError, errorForStatus } from "./errors";
import { normalizePhone } from "./phone";
import type { ChannelAdapter, InboundMessage, MediaInput, OutboundButton, OutboundContent, SendResult } from "./types";

export interface MetaCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/**
 * Esqueleto da API oficial (WhatsApp Cloud API). Cobre texto, botões, mídia e entrada.
 * Pendências para a migração (docs/03): templates aprovados fora da janela de 24 h,
 * verificação do webhook (hub.challenge) e assinatura X-Hub-Signature-256.
 * Envio a grupos não é suportado pela API oficial.
 */
export class MetaCloudAdapter implements ChannelAdapter {
  readonly name = "meta-cloud";
  private readonly doFetch: typeof fetch;

  constructor(private readonly cfg: MetaCloudConfig) {
    this.doFetch = cfg.fetch ?? fetch;
  }

  private base(): string {
    return `https://graph.facebook.com/${this.cfg.apiVersion ?? "v21.0"}`;
  }

  private async request(url: string, init?: RequestInit): Promise<Json> {
    let res: Response;
    try {
      res = await this.doFetch(url, {
        ...init,
        headers: { authorization: `Bearer ${this.cfg.accessToken}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ChannelError("Meta inacessível", true);
    }
    if (!res.ok) throw errorForStatus(res.status, "Meta recusou a requisição");
    const json: unknown = await res.json().catch(() => ({}));
    return isObj(json) ? json : {};
  }

  private async send(body: Json): Promise<SendResult> {
    const json = await this.request(`${this.base()}/${this.cfg.phoneNumberId}/messages`, {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const messages = json["messages"];
    const first = Array.isArray(messages) ? messages[0] : undefined;
    const id = isObj(first) ? str(first["id"]) : undefined;
    if (!id) throw new ChannelError("Meta não devolveu o id da mensagem", true);
    return { providerMessageId: id };
  }

  sendText(to: string, text: string): Promise<SendResult> {
    return this.send({ to: to.replace(/\D/g, ""), type: "text", text: { body: text } });
  }

  sendButtons(to: string, content: { text: string; buttons: OutboundButton[] }): Promise<SendResult> {
    const replies = content.buttons.filter((b) => b.kind !== "call").slice(0, 3);
    return this.send({
      to: to.replace(/\D/g, ""),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: content.text },
        action: { buttons: replies.map((b) => ({ type: "reply", reply: { id: b.id, title: b.label.slice(0, 20) } })) },
      },
    });
  }

  async sendMedia(to: string, media: MediaInput): Promise<SendResult> {
    const kind = media.mimeType.startsWith("image/") ? "image" : "document";
    if (!media.url) throw new ChannelError("Meta exige URL (ou upload prévio) para mídia", false);
    return this.send({
      to: to.replace(/\D/g, ""),
      type: kind,
      [kind]: { link: media.url, caption: media.caption, ...(kind === "document" ? { filename: media.fileName } : {}) },
    });
  }

  sendToGroup(_groupId: string, _content: OutboundContent): Promise<SendResult> {
    return Promise.reject(new ChannelError("A API oficial da Meta não envia a grupos; usar envio individual", false));
  }

  parseInbound(raw: unknown): InboundMessage[] {
    if (!isObj(raw) || !Array.isArray(raw["entry"])) return [];
    const out: InboundMessage[] = [];
    for (const entry of raw["entry"] as unknown[]) {
      const changes = isObj(entry) && Array.isArray(entry["changes"]) ? (entry["changes"] as unknown[]) : [];
      for (const change of changes) {
        const value = isObj(change) ? change["value"] : undefined;
        const messages = isObj(value) && Array.isArray(value["messages"]) ? (value["messages"] as unknown[]) : [];
        for (const m of messages) {
          if (!isObj(m)) continue;
          const id = str(m["id"]);
          const from = typeof m["from"] === "string" ? normalizePhone(m["from"]) : null;
          if (!id || !from) continue;
          const receivedAt = new Date(Number(m["timestamp"]) * 1000 || Date.now());
          const base = { providerMessageId: id, from, receivedAt };
          const type = str(m["type"]);
          const textObj = m["text"];
          if (type === "text" && isObj(textObj) && str(textObj["body"])) {
            out.push({ ...base, type: "text", text: textObj["body"] as string });
          } else if (type === "interactive" && isObj(m["interactive"])) {
            const br = (m["interactive"] as Json)["button_reply"];
            const bid = isObj(br) ? str(br["id"]) : undefined;
            if (bid) out.push({ ...base, type: "button", buttonId: bid });
          } else if (type === "audio" && isObj(m["audio"])) {
            const a = m["audio"] as Json;
            const ref = str(a["id"]);
            if (ref) out.push({ ...base, type: "audio", media: { mimeType: str(a["mime_type"]) ?? "audio/ogg", ref } });
          } else if (type === "image" && isObj(m["image"])) {
            const i = m["image"] as Json;
            const ref = str(i["id"]);
            const caption = str(i["caption"]);
            if (ref) {
              out.push({
                ...base,
                type: "image",
                ...(caption ? { text: caption } : {}),
                media: { mimeType: str(i["mime_type"]) ?? "image/jpeg", ref },
              });
            }
          }
        }
      }
    }
    return out;
  }

  async fetchMedia(message: InboundMessage): Promise<{ data: Uint8Array; mimeType: string }> {
    const ref = message.media?.ref;
    if (!ref) throw new ChannelError("Mídia sem referência", false);
    const meta = await this.request(`${this.base()}/${ref}`);
    const url = str(meta["url"]);
    if (!url) throw new ChannelError("Meta não devolveu a URL da mídia", true);
    let res: Response;
    try {
      res = await this.doFetch(url, { headers: { authorization: `Bearer ${this.cfg.accessToken}` } });
    } catch {
      throw new ChannelError("Meta inacessível", true);
    }
    if (!res.ok) throw errorForStatus(res.status, "Falha ao baixar a mídia");
    return {
      data: new Uint8Array(await res.arrayBuffer()),
      mimeType: str(meta["mime_type"]) ?? message.media?.mimeType ?? "application/octet-stream",
    };
  }
}
