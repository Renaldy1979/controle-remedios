const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;

export const SCHEME_TZ = "America/Sao_Paulo";

/** Data (aaaa-mm-dd) e minutos do dia de um instante no fuso do sistema. */
export function localNow(now: Date, tz: string = SCHEME_TZ): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Próximo horário "redondo" (de 30 em 30 min) depois de agora: 22:21 → 22:30; 22:30 → 23:00. Depois das 23:30 vira 00:00 de amanhã. */
export function nextSlot(now: Date, tz: string = SCHEME_TZ, stepMin = 30): { time: string; tomorrow: boolean } {
  const { minutes } = localNow(now, tz);
  const next = (Math.floor(minutes / stepMin) + 1) * stepMin;
  return next >= 1440 ? { time: "00:00", tomorrow: true } : { time: hhmm(next), tomorrow: false };
}

/** aaaa-mm-dd somando dias (sem fuso: só calendário). */
export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
