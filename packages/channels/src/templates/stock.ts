import { daysText, ESTIMATE_NOTE, levelText, replyButton, title } from "./format";
import type { LowStockParams, Rendered, StockReplyParams } from "./types";

export function lowStock(p: LowStockParams): Rendered {
  const icon = p.level === "critical" ? "🔴" : "🟡";
  const est = p.isEstimate ? " (estimativa)" : "";
  const note = p.isEstimate ? `\n${ESTIMATE_NOTE}` : "";
  return {
    text: `${title(icon, `Estoque baixo — ${p.patientName}`)}\n${p.medicationName}: ${daysText(p.daysLeft)}${est}.${note}`,
    buttons: [
      replyButton("replenish_claim", p.familyId, p.replenishmentId, "Eu cuido disso"),
      replyButton("rx_view", p.familyId, p.replenishmentId, "Ver receita"),
    ],
  };
}

export function replenishClaimed(p: { patientName: string; medicationName: string; ownerName: string; isYou: boolean }): Rendered {
  const who = p.isYou ? "Você cuida" : `${p.ownerName} cuida`;
  return { text: `${title("🤝", "Reposição assumida")}\n${who} de ${p.medicationName} (${p.patientName}).` };
}

export function replenishUnavailable(): Rendered {
  return { text: `${title("ℹ️", "Reposição não encontrada")}\nEssa reposição já foi encerrada ou não existe mais.` };
}

export function stockReply(p: StockReplyParams): Rendered {
  if (p.lines.length === 0) return { text: `${title("📦", "Estoque")}\nNão há remédios com estoque cadastrado.` };
  const hasEstimate = p.lines.some((l) => l.isEstimate);
  const body = p.lines
    .map((l) => `${levelText[l.level]} · ${l.patientName} — ${l.medicationName}: ${daysText(l.daysLeft)}${l.isEstimate ? " (estimativa)" : ""}`)
    .join("\n");
  return { text: `${title("📦", "Estoque")}\n${body}${hasEstimate ? `\n${ESTIMATE_NOTE}` : ""}` };
}
