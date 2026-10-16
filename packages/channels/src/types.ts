/** Contrato do canal de mensagens. Nenhuma regra de negócio conhece o provedor (Evolution, Meta...). */

export interface OutboundButton {
  /** Identificador devolvido pelo provedor quando a pessoa toca no botão (ver buttons.ts). */
  id: string;
  /** Até 20 caracteres (limite do WhatsApp). */
  label: string;
  kind?: "reply" | "call";
  /** Só para kind "call": telefone em E.164. */
  phone?: string;
}

export interface MediaInput {
  /** URL temporária (assinada) OU base64. */
  url?: string;
  base64?: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
}

export interface OutboundContent {
  text: string;
  buttons?: OutboundButton[];
  media?: MediaInput;
}

export interface SendResult {
  providerMessageId: string;
}

export type InboundType = "text" | "button" | "audio" | "image";

export interface InboundMedia {
  mimeType: string;
  base64?: string;
  url?: string;
  /** Referência opaca do provedor para baixar a mídia depois (`fetchMedia`). */
  ref?: string;
}

/** Mensagem recebida, normalizada, independente do provedor. */
export interface InboundMessage {
  providerMessageId: string;
  /** Telefone do remetente em E.164 (em grupo: quem escreveu, não o grupo). */
  from: string;
  /** Presente quando a mensagem veio de um grupo. */
  groupId?: string;
  type: InboundType;
  text?: string;
  buttonId?: string;
  media?: InboundMedia;
  receivedAt: Date;
}

export interface ChannelAdapter {
  readonly name: string;
  sendText(to: string, text: string): Promise<SendResult>;
  sendButtons(to: string, content: { text: string; buttons: OutboundButton[] }): Promise<SendResult>;
  sendMedia(to: string, media: MediaInput): Promise<SendResult>;
  /** `groupId` no formato do provedor (Evolution: `...@g.us`). */
  sendToGroup(groupId: string, content: OutboundContent): Promise<SendResult>;
  /** Converte o corpo bruto do webhook em mensagens normalizadas. Ignora eventos que não são mensagens recebidas. */
  parseInbound(raw: unknown): InboundMessage[];
  /** Baixa a mídia (áudio/imagem) de uma mensagem recebida. */
  fetchMedia(message: InboundMessage): Promise<{ data: Uint8Array; mimeType: string }>;
}

/** Envia conteúdo escolhendo o método certo do adaptador. */
export function sendContent(adapter: ChannelAdapter, to: string, content: OutboundContent): Promise<SendResult> {
  if (content.media) return adapter.sendMedia(to, { ...content.media, caption: content.media.caption ?? content.text });
  if (content.buttons && content.buttons.length > 0) {
    return adapter.sendButtons(to, { text: content.text, buttons: content.buttons });
  }
  return adapter.sendText(to, content.text);
}
