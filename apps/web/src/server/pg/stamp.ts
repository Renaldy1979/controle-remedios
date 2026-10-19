import { localParts } from "@medcuidar/domain";

const p2 = (n: number) => String(n).padStart(2, "0");

/** "dd/mm/aaaa às HH:mm" no fuso da família. */
export function stampLabel(d: Date, tz: string): string {
  const { date, minutes } = localParts(d, tz);
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)} às ${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`;
}
