import type { OutboundButton, OutboundContent } from "./types";

/**
 * Botões interativos são instáveis em conexões não oficiais (Baileys/whatsmeow). O caminho padrão é
 * texto com opções numeradas, gerado da MESMA definição de botões dos templates.
 */

/** Evolution Go não deixa misturar `reply` com `call/url/copy`: respostas viram botões, ligações viram texto. */
export function splitButtons(buttons: OutboundButton[] = []): { replies: OutboundButton[]; calls: OutboundButton[] } {
  return { replies: buttons.filter((b) => b.kind !== "call"), calls: buttons.filter((b) => b.kind === "call") };
}

/** Opções que uma resposta "1", "2"... escolhe, na ordem em que aparecem. */
export function numberedOptions(buttons: OutboundButton[] = []): OutboundButton[] {
  return splitButtons(buttons).replies;
}

const callLines = (calls: OutboundButton[]) => calls.filter((c) => c.phone).map((c) => `📞 ${c.label}: ${c.phone}`);

/** Texto com as ligações citadas (para o modo com botões reais, onde `call` não pode ir junto). */
export function textWithCalls(content: OutboundContent): string {
  const lines = callLines(splitButtons(content.buttons).calls);
  return lines.length ? `${content.text}\n${lines.join("\n")}` : content.text;
}

/** Versão em texto: "Responda 1 para Tomei, 2 para Lembrar em 15 min". */
export function renderNumbered(content: OutboundContent): string {
  const { replies } = splitButtons(content.buttons);
  const parts = [textWithCalls(content)];
  if (replies.length > 0) {
    parts.push("", "Responda com o número:", ...replies.map((b, i) => `*${i + 1}* — ${b.label}`));
  }
  return parts.join("\n");
}

/** Conteúdo pronto para um canal: sem botões reais, vira texto numerado. */
export function degradeContent(content: OutboundContent, supportsButtons: boolean): OutboundContent {
  if (supportsButtons || !content.buttons?.length) return content;
  const text = renderNumbered(content);
  return content.media
    ? { text, media: { ...content.media, caption: text } }
    : { text };
}
