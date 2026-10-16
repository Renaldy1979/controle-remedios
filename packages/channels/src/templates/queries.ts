import { title } from "./format";
import type { DoseStatusReplyParams, NextDosesReplyParams, Rendered } from "./types";

export function nextDosesReply(p: NextDosesReplyParams): Rendered {
  if (p.lines.length === 0) return { text: `${title("🕒", "Próximas doses")}\nNão há mais doses hoje.` };
  const body = p.lines.map((l) => `• ${l.time} · ${l.patientName} — ${l.medicationName}, ${l.doseText}`).join("\n");
  return { text: `${title("🕒", "Próximas doses")}\n${body}` };
}

const STATUS_TEXT: Record<DoseStatusReplyParams["lines"][number]["status"], string> = {
  taken: "✅ tomada",
  pending: "⏳ aguardando",
  late: "🟠 atrasada",
  missed: "🔴 esquecida",
  skipped: "⚪ pulada",
};

export function doseStatusReply(p: DoseStatusReplyParams): Rendered {
  if (p.lines.length === 0) return { text: `${title("💊", "Doses de hoje")}\nNão achei doses de "${p.query}" hoje.` };
  const body = p.lines
    .map((l) => `• ${l.patientName} — ${l.medicationName} às ${l.time}: ${STATUS_TEXT[l.status]}${l.takenAt ? ` (às ${l.takenAt})` : ""}`)
    .join("\n");
  return { text: `${title("💊", "Doses de hoje")}\n${body}` };
}
