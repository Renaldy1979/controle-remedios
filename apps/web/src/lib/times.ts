const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Horários do dia a partir do primeiro horário e do intervalo (mesma conta de `dosesPerDay` do domínio). */
export function intervalTimes(firstTime: string, everyHours: number): string[] {
  if (!HHMM.test(firstTime) || !(everyHours > 0)) return [];
  const start = Number(firstTime.slice(0, 2)) * 60 + Number(firstTime.slice(3, 5));
  const step = everyHours * 60;
  const out: string[] = [];
  for (let m = start; m < 1440; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`);
  return out;
}
