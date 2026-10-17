import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelError } from "./errors";
import { degradeContent } from "./options";
import type { ChannelAdapter, InboundMessage, MediaInput, OutboundButton, OutboundContent, SendResult } from "./types";

export interface SentRecord {
  to: string;
  isGroup: boolean;
  text: string;
  buttons?: OutboundButton[];
  media?: MediaInput;
}

/** Canal em memória para testes e simulador: nada sai para a rede. */
export const DEFAULT_FAKE_LOG = join(tmpdir(), "medcuidar-fake-channel.jsonl");

export class FakeChannel implements ChannelAdapter {
  readonly name = "fake";

  /** `persistTo`: grava cada envio em um arquivo JSONL, para outro processo (teste e2e) ler. */
  constructor(private readonly persistTo?: string) {}
  /** Com `false` imita o Evolution Go: botões viram texto numerado. */
  supportsButtons = true;
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
    if (this.persistTo) appendFileSync(this.persistTo, `${JSON.stringify({ ...rec, at: new Date().toISOString() })}\n`);
    this.seq += 1;
    return Promise.resolve({ providerMessageId: `fake-out-${this.seq}` });
  }

  sendText(to: string, text: string) {
    return this.record({ to, isGroup: false, text });
  }
  sendButtons(to: string, content: { text: string; buttons: OutboundButton[] }) {
    const c = degradeContent(content, this.supportsButtons);
    return this.record({ to, isGroup: false, text: c.text, ...(c.buttons ? { buttons: c.buttons } : {}) });
  }
  sendMedia(to: string, media: MediaInput) {
    return this.record({ to, isGroup: false, text: media.caption ?? "", media });
  }
  sendToGroup(groupId: string, content: OutboundContent) {
    return this.record({ to: groupId, isGroup: true, ...degradeContent(content, this.supportsButtons) });
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

/** Lê o log do canal falso persistido (uma linha JSON por envio). */
export function readFakeChannelLog(file: string = DEFAULT_FAKE_LOG): SentRecord[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as SentRecord);
}

/** Último código de login (6 dígitos) enviado a este telefone — só para testes com o canal falso. */
export function lastLoginCode(phoneE164: string, records: SentRecord[] = readFakeChannelLog()): string | null {
  for (const r of [...records].reverse()) {
    if (r.to !== phoneE164 || !r.text.includes("Código de acesso")) continue;
    const m = /\*(\d{6})\*/.exec(r.text);
    if (m) return m[1]!;
  }
  return null;
}
