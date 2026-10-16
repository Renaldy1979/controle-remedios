import type { OutboundButton } from "../types";
import { encodeButtonId, type ButtonAction } from "../buttons";

/** Título em negrito do WhatsApp com ícone: o estado nunca depende só de cor. */
export const title = (icon: string, text: string) => `${icon} *${text}*`;

export function clip(label: string, max = 20): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

export function replyButton(action: ButtonAction, familyId: string, ref: string, label: string): OutboundButton {
  return { id: encodeButtonId(action, familyId, ref), label: clip(label), kind: "reply" };
}

/** `2026-10-15` -> `15/10/2026`. */
export function dateBR(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const daysText = (n: number) => (n <= 0 ? "acaba hoje" : `${n} ${plural(n, "dia", "dias")} de estoque`);

export type StockLevel = "ok" | "attention" | "critical";
export const levelText: Record<StockLevel, string> = {
  ok: "🟢 Ok",
  attention: "🟡 Atenção",
  critical: "🔴 Crítico",
};

export const ESTIMATE_NOTE = "_Estimativa: colírio varia com a gota. Confira o frasco._";
