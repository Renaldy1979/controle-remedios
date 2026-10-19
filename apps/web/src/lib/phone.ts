/**
 * Telefone: guardamos só dígitos com DDI (55) + DDD + número (10 a 15 dígitos), como em `members.phone_*`.
 * O usuário digita com ou sem o 55.
 */
export function normalizePhone(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^[0-9]{12,15}$/.test(d) ? d : null;
}

/** "5511912345678" -> "(11) 91234-5678" (só para número brasileiro; outros voltam como "+<dígitos>"). */
export function formatPhone(digits: string): string {
  const d = String(digits ?? "").replace(/\D/g, "");
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : d ? `+${d}` : "";
}

/** Para exibir sem expor o número inteiro (ex.: confirmação de convite). */
export function maskPhone(digits: string): string {
  const f = formatPhone(digits);
  return f.length > 4 ? `${f.slice(0, -4).replace(/\d/g, "•")}${f.slice(-4)}` : f;
}
