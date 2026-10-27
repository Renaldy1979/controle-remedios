const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Horários do dia a partir do primeiro horário e do intervalo (mesma conta de `dosesPerDay` do domínio). */
export function intervalTimes(firstTime: string, everyHours: number): string[] {
  if (!HHMM.test(firstTime) || !(everyHours > 0)) return [];
  const step = everyHours * 60;
  const out: string[] = [];
  for (let m = toMin(firstTime); m < 1440; m += step) out.push(hhmm(m));
  return out;
}

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

export interface DayPreview {
  /** todos os horários de um dia do esquema */
  daily: string[];
  /** horários de hoje que ainda não passaram (só quando o tratamento já vale hoje) */
  todayLeft: string[];
  /** horários de hoje que já passaram */
  todayPast: string[];
  /** quantas doses por dia o intervalo comportaria se o dia começasse à meia-noite */
  fullDay: number;
  /** o primeiro horário corta o dia: cabem menos doses do que 24 h / intervalo */
  cutsDay: boolean;
}

/** Prévia do que o esquema gera: o dia "normal" e o dia de hoje. `startsToday` = o dia 1 é hoje (ou antes). */
export function previewDay(firstTime: string, everyHours: number, nowMinutes: number, startsToday: boolean): DayPreview {
  const daily = intervalTimes(firstTime, everyHours);
  const fullDay = everyHours > 0 ? Math.floor(1440 / (everyHours * 60)) + (1440 % (everyHours * 60) ? 1 : 0) : 0;
  const todayLeft = startsToday ? daily.filter((t) => toMin(t) >= nowMinutes) : [];
  const todayPast = startsToday ? daily.filter((t) => toMin(t) < nowMinutes) : [];
  // só avisa quando o intervalo fecha o dia certinho (1, 2, 3, 4, 6, 8, 12 h...) e o primeiro horário perde doses
  const exact = everyHours > 0 && 24 % everyHours === 0;
  return { daily, todayLeft, todayPast, fullDay, cutsDay: exact && daily.length > 0 && daily.length < 24 / everyHours };
}
