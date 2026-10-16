/** Fuso: guardar UTC, exibir local (America/Sao_Paulo por padrão). Horário 24h, datas dd/mm/aaaa. */

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  weekday: number;
}

export function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const get = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: get["year"]!,
    month: get["month"]!,
    day: get["day"]!,
    hour: get["hour"] === "24" ? "00" : get["hour"]!,
    minute: get["minute"]!,
    weekday: weekdays.indexOf(get["weekday"]!),
  };
}

/** `YYYY-MM-DD` no fuso. */
export function localDate(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `HH:mm` no fuso. */
export function localTime(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.hour}:${p.minute}`;
}

export function localMinutesOfDay(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function dateBR(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Dias inteiros entre duas datas YYYY-MM-DD. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}
