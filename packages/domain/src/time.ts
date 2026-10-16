/** Utilitários de data/hora com fuso. Guardamos UTC; "dia" e "horário" são sempre locais ao fuso. */

export const DEFAULT_TZ = "America/Sao_Paulo";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutos desde 00:00 local
  weekday: number; // 0 = domingo
}

export function localParts(instant: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(instant)) p[part.type] = part.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    date,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

/** Diferença (ms) entre a hora de parede no fuso e UTC naquele instante. */
function offsetMs(instant: Date, tz: string): number {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(instant)) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Converte data local (YYYY-MM-DD) + minutos locais em instante UTC.
 * Horário inexistente (salto de horário de verão) avança para depois do salto;
 * horário ambíguo (volta) usa a primeira ocorrência.
 */
export function zonedToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, 0, minutes, 0);
  const o1 = offsetMs(new Date(wall), tz);
  let t = wall - o1;
  const o2 = offsetMs(new Date(t), tz);
  if (o2 !== o1) {
    t = wall - o2;
    // salto: o resultado não "volta" ao mesmo horário local; avança pela diferença
    if (offsetMs(new Date(t), tz) !== o2) t = wall - Math.max(o1, o2);
  }
  // ambiguidade: prefere a primeira ocorrência (maior offset)
  const earlier = t - 3600_000;
  if (localParts(new Date(earlier), tz).date === date && localMinutes(new Date(earlier), tz) === minutes) t = earlier;
  return new Date(t);
}

function localMinutes(i: Date, tz: string): number {
  return localParts(i, tz).minutes;
}

export function parseHHmm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Horário inválido: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}
