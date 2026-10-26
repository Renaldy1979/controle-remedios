/**
 * Interpretação determinística de mensagens do WhatsApp (sem IA). Na dúvida devolve "livre": nunca chuta.
 * Regras aproveitadas do escopo anterior (apps/functions/src/inbound/interpret.ts), agora sem dependência dele.
 */

export type Intent =
  | "codigo"
  | "opcao"
  | "dose_tomada"
  | "nao_tomou"
  | "lembrar_depois"
  | "eu_cuido"
  | "estoque"
  | "proximas_doses"
  | "dose_status"
  | "link_acesso"
  | "ajuda"
  | "tomei_todos"
  | "um_por_um"
  | "pular"
  | "livre";

/** Só ✅/👍/✔ (com ou sem tom de pele): confirmação sem palavras. */
const CONFIRM_EMOJI = /^(?:\s|✅|✔|☑|️|\u{1F44D}|[\u{1F3FB}-\u{1F3FF}])+$/u;

/** Código de 6 dígitos, com ou sem a palavra "código" (ex.: "CÓDIGO 123456", "123 456"). */
export function parseCode(text: string): string | null {
  const m = /^\s*(?:c[oó]digo\s*[:-]?\s*)?(\d{3})[\s-]?(\d{3})\s*\.?\s*$/i.exec(String(text ?? ""));
  return m ? `${m[1]}${m[2]}` : null;
}

/** Resposta "1", "2", "3." a uma lista numerada. Devolve o número ou null. */
export function parseOption(text: string): number | null {
  const m = /^\s*([1-9])\s*[.):]?\s*$/.exec(String(text ?? ""));
  return m ? Number(m[1]) : null;
}

export function normalizeText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\?/g, " ? ")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

export function interpretText(text: string): Intent {
  if (parseCode(text)) return "codigo";
  if (parseOption(text) !== null) return "opcao";
  if (CONFIRM_EMOJI.test(text ?? "")) return "dose_tomada";
  const t = normalizeText(text);
  if (!t) return "livre";
  if (/^(ok|okay|feito|pronto|certo)$/.test(t)) return "dose_tomada";
  const isQuestion = t.includes("?") || /^(como|quando|qual|quais|quanto|quantos|que horas|tem|o que)\b/.test(t);

  // vários remédios do mesmo horário (lembrete agrupado): "todos", "tomei todos", "um por um", "não vou tomar"
  if (/^(todos|todas|tomei todos|tomei todas|tomaram todos|tomou todos|dei todos|ja tomou todos|ja tomaram todos)$/.test(t)) return "tomei_todos";
  if (has(t, /\b(um por um|uma por uma|um a um|confirmar um|confirmo um)\b/)) return "um_por_um";
  if (has(t, /\b(nao vou tomar|nao vai tomar|nao quer tomar|nao vou dar|vou pular|pular)\b/)) return "pular";
  if (has(t, /\b(nao|ainda nao|esqueci|nem)\b.*\b(tomei|tomou|tomaram|dei|dado)\b/)) return "nao_tomou";
  if (has(t, /\b(eu cuido|cuido disso|eu compro|eu resolvo|eu assumo|assumo)\b/)) return "eu_cuido";
  if (has(t, /\b(lembr\w*|avis\w*)\b.*\b(de novo|depois|mais tarde|em \d+ ?(min|minutos))\b|^(depois|mais tarde|adiar|soneca)$/)) return "lembrar_depois";
  if (has(t, /\b(link|primeiro acesso)\b|\bcriar (minha )?senha\b|\bacesso ao portal\b/)) return "link_acesso";
  if (has(t, /\b(estoque|sobrando|quantos dias|acabando|vai acabar)\b/)) return "estoque";
  // quantidade restante: "quantos comprimidos de X eu tenho?", "quanto resta do X", "quantidade restante". NÃO pega "quantos comprimidos eu tomo" (dose).
  if (has(t, /\bquant[oa]s? .{0,40}\b(tenho|tem|temos|resta|restam|sobra|sobram|sobrou|sobraram)\b|\bquanto (resta|restou|sobra|sobrou|tenho|temos|tem)\b|\bquantidade (restante|em estoque|que (resta|tenho|temos))\b/)) return "estoque";
  if (has(t, /\b(proxima|proximas|proximo|proximos)\b.*\b(dose|doses|horario|horarios|remedio|remedios)\b|\bque horas\b|\bfalta tomar\b|\bo que falta\b|\bhorarios\b/)) return "proximas_doses";
  if (isQuestion && has(t, /\b(tomou|tomaram|tomei|tomada|tomado)\b/)) return "dose_status";
  if (has(t, /\b(tomei|tomou|tomaram|tomada|tomado|dei|confirmo|confirmado)\b/)) return "dose_tomada";
  if (has(t, /^(oi|ola|ajuda|menu|help|bom dia|boa tarde|boa noite)\b/)) return "ajuda";
  return "livre";
}

export interface Mentions {
  medicationIds: string[];
  patientIds: string[];
}

/** Acha remédios (nome ou alternativos) e pacientes (primeiro nome) citados no texto. */
export function findMentions(
  text: string,
  patients: Array<{ id: string; name: string }>,
  medications: Array<{ id: string; name: string; alternativeNames?: string[] | null }>,
): Mentions {
  const t = ` ${normalizeText(text)} `;
  const med = new Set<string>();
  for (const m of medications) {
    for (const name of [m.name, ...(m.alternativeNames ?? [])]) {
      const nn = normalizeText(name);
      if (nn.length >= 3 && t.includes(` ${nn} `)) med.add(m.id);
    }
  }
  const pat = new Set<string>();
  for (const p of patients) {
    const first = normalizeText(p.name).split(" ")[0] ?? "";
    if (first.length >= 3 && t.includes(` ${first} `)) pat.add(p.id);
  }
  return { medicationIds: [...med], patientIds: [...pat] };
}
