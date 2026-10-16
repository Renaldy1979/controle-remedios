/**
 * Codificação dos IDs de botão: `mc1:<ação>:<familyId>:<ref>`.
 * O id leva a família para o webhook resolver o contexto sem adivinhar quando o telefone
 * pertence a mais de uma família. O webhook confere se o remetente é membro dela.
 */
export const BUTTON_ACTIONS = [
  "dose_taken",
  "dose_snooze",
  "replenish_claim",
  "rx_view",
  "rx_download",
  "rx_forward_pharmacy",
] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export interface DecodedButton {
  action: ButtonAction;
  familyId: string;
  ref: string;
}

export function encodeButtonId(action: ButtonAction, familyId: string, ref: string): string {
  return `mc1:${action}:${familyId}:${ref}`;
}

export function decodeButtonId(id: string): DecodedButton | null {
  const parts = id.split(":");
  if (parts.length < 4 || parts[0] !== "mc1") return null;
  const action = parts[1] as ButtonAction;
  if (!BUTTON_ACTIONS.includes(action)) return null;
  const familyId = parts[2]!;
  const ref = parts.slice(3).join(":");
  if (!familyId || !ref) return null;
  return { action, familyId, ref };
}
