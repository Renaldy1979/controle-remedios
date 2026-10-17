import type { Row } from "../ports";
import { s } from "../rows";

export type TextIntent =
  | "dose_taken"
  | "not_taken"
  | "stock_status"
  | "next_doses"
  | "dose_status"
  | "help"
  | "unknown";

/** Só ✅/👍/✔ (com ou sem tom de pele): confirmação sem palavras. */
const CONFIRM_EMOJI = /^(?:\s|✅|✔|☑|️|\u{1F44D}|[\u{1F3FB}-\u{1F3FF}])+$/u;

/** Resposta "1", "2", "3." à lista numerada. Devolve o número ou null. */
export function parseOption(text: string): number | null {
  const m = /^\s*([1-9])\s*[.):]?\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\?/g, " ? ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

/**
 * Interpretação determinística de texto (ou transcrição de áudio).
 * Na dúvida devolve "unknown" ou deixa o passo seguinte perguntar com botões — nunca chuta.
 */
export function interpretText(text: string): TextIntent {
  if (CONFIRM_EMOJI.test(text)) return "dose_taken";
  const t = normalizeText(text);
  if (!t) return "unknown";
  if (/^(ok|okay|feito|pronto|certo)$/.test(t)) return "dose_taken";
  const isQuestion = t.includes("?") || /^(como|quando|qual|quais|quanto|quantos|que horas|tem|o que)\b/.test(t);

  if (has(t, /\b(nao|ainda nao|esqueci|nem)\b.*\b(tomei|tomou|tomaram|dei|dado)\b/)) return "not_taken";
  if (has(t, /\b(estoque|sobrando|quantos dias|acabando|vai acabar)\b/)) return "stock_status";
  if (has(t, /\b(proxima|proximas|proximo|proximos)\b.*\b(dose|doses|horario|horarios|remedio|remedios)\b|\bque horas\b|\bfalta tomar\b|\bo que falta\b|\bhorarios\b/)) return "next_doses";
  if (isQuestion && has(t, /\b(tomou|tomaram|tomei|tomada|tomado)\b/)) return "dose_status";
  if (has(t, /\b(tomei|tomou|tomaram|tomada|tomado|dei|confirmo|confirmado)\b/)) return "dose_taken";
  if (has(t, /^(oi|ola|ajuda|menu|help|bom dia|boa tarde|boa noite)\b/)) return "help";
  return "unknown";
}

export interface Mentions {
  medicationIds: string[];
  patientIds: string[];
}

/** Acha remédios (nome ou alternativos) e pacientes (primeiro nome) citados no texto. */
export function findMentions(text: string, patients: Row[], medications: Row[]): Mentions {
  const t = ` ${normalizeText(text)} `;
  const med = new Set<string>();
  for (const m of medications) {
    const names = [s(m, "name"), ...(Array.isArray(m["alternative_names"]) ? (m["alternative_names"] as string[]) : [])];
    for (const name of names) {
      const nn = normalizeText(name);
      if (nn.length >= 3 && t.includes(` ${nn} `)) med.add(m.$id);
    }
  }
  const pat = new Set<string>();
  for (const p of patients) {
    const first = normalizeText(s(p, "name")).split(" ")[0] ?? "";
    if (first.length >= 3 && t.includes(` ${first} `)) pat.add(p.$id);
  }
  return { medicationIds: [...med], patientIds: [...pat] };
}

/** Remove números de telefone e sequências de 6+ dígitos antes de guardar o corpo em `whatsapp_messages`. */
export function redactBody(text: string): string {
  return text.replace(/\+?\d[\d\s().-]{4,}\d/g, "[numero]").slice(0, 200);
}
