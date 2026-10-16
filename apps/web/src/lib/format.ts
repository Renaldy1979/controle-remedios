/** Formatação pt-BR: datas dd/mm/aaaa, horas 24h. Fuso de exibição: America/Sao_Paulo. */

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

const p2 = (n: number) => String(n).padStart(2, "0");

export const fmtDate = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
export const fmtShort = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
export const fmtWeekday = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${fmtShort(d)}`;
export const fmtTime = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** "dd/mm/aaaa" -> Date, ou null se inválida. */
export function parseDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** 70 -> "1 h 10", 45 -> "45 min" */
export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${p2(m)}` : `${h} h`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");
