import { ChannelError } from "./errors";
import type { ChannelAdapter, InboundMessage, MediaInput, OutboundButton, OutboundContent, SendResult } from "./types";

export interface SentRecord {
  to: string;
  isGroup: boolean;
  text: string;
  buttons?: OutboundButton[];
  media?: MediaInput;
}

/** Canal em memória para testes e simulador: nada sai para a rede. */
export class FakeChannel implements ChannelAdapter {
  readonly name = "fake";
  sent: SentRecord[] = [];
  /** Simula o provedor fora do ar (erro retentável). */
  down = false;
  /** Próximos N envios falham com erro definitivo. */
  rejectNext = 0;
  mediaStore = new Map<string, { data: Uint8Array; mimeType: string }>();
  private seq = 0;

  private record(rec: SentRecord): Promise<SendResult> {
    if (this.down) return Promise.reject(new ChannelError("Canal fake fora do ar", true));
    if (this.rejectNext > 0) {
      this.rejectNext -= 1;
      return Promise.reject(new ChannelError("Canal fake recusou", false, 400));
    }
    this.sent.push(rec);
    this.seq += 1;
    return Promise.resolve({ providerMessageId: `fake-out-${this.seq}` });
  }

  sendText(to: string, text: string) {
    return this.record({ to, isGroup: false, text });
  }
  sendButtons(to: string, content: { text: string; buttons: OutboundButton[] }) {
    return this.record({ to, isGroup: false, text: content.text, buttons: content.buttons });
  }
  sendMedia(to: string, media: MediaInput) {
    return this.record({ to, isGroup: false, text: media.caption ?? "", media });
  }
  sendToGroup(groupId: string, content: OutboundContent) {
    return this.record({ to: groupId, isGroup: true, ...content });
  }

  /** Aceita `InboundMessage[]` já normalizado (o simulador monta direto). */
  parseInbound(raw: unknown): InboundMessage[] {
    if (!Array.isArray(raw)) return [];
    return (raw as InboundMessage[]).map((m) => ({ ...m, receivedAt: new Date(m.receivedAt) }));
  }

  fetchMedia(message: InboundMessage): Promise<{ data: Uint8Array; mimeType: string }> {
    const found = message.media?.ref ? this.mediaStore.get(message.media.ref) : undefined;
    return found ? Promise.resolve(found) : Promise.reject(new ChannelError("Mídia fake inexistente", false));
  }
}
