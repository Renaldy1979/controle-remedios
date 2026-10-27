import { schemeDosesOnDate } from "@/lib/scheme";

/** O mínimo de um remédio que o calendário precisa (subconjunto de `MedicationVM`). */
export interface CalendarMed {
  id: string;
  patientId: string;
  name: string;
  unitLabel: string;
  /** hora de início (âncora do intervalo contínuo) */
  firstTime: string;
  /** aaaa-mm-dd: dia 1 do esquema */
  startDate?: string | undefined;
  phases: Array<{ order: number; everyHours: number; fromDay: number; toDay: number | null; perDose: number }>;
}

export interface CalendarDose {
  time: string;
  medicationId: string;
  patientId: string;
  medName: string;
  doseText: string;
}

export const isoOf = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);

/** Doses que o esquema gera num dia (aaaa-mm-dd), ordenadas por horário (mesmo cálculo do servidor). Antes do dia 1 não há nenhuma. */
export function dosesOnDate(meds: CalendarMed[], date: string): CalendarDose[] {
  const out: CalendarDose[] = [];
  for (const m of meds) {
    if (!m.startDate || date < m.startDate) continue;
    const phases = m.phases.map((p) => ({ everyHours: p.everyHours, fromDay: p.fromDay, toDay: p.toDay, perDose: p.perDose }));
    for (const d of schemeDosesOnDate({ startDate: m.startDate, firstTime: m.firstTime, phases, date })) {
      out.push({ time: d.time, medicationId: m.id, patientId: m.patientId, medName: m.name, doseText: `${String(d.perDose).replace(".", ",")} × ${m.unitLabel.toLowerCase()}` });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.medName.localeCompare(b.medName, "pt-BR"));
}

export interface MonthCell {
  /** aaaa-mm-dd */
  date: string;
  inMonth: boolean;
}

/** Grade do mês em semanas de domingo a sábado (6 linhas no máximo), com os dias vizinhos marcados como fora do mês. */
export function monthGrid(year: number, month0: number): MonthCell[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const lead = first.getUTCDay();
  const total = Math.ceil((lead + new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()) / 7) * 7;
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(year, month0, 1 - lead + i));
    const cell = { date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month0 };
    if (i % 7 === 0) weeks.push([cell]);
    else weeks[weeks.length - 1]!.push(cell);
  }
  return weeks;
}

export const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const WEEKDAYS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const WEEKDAYS_LONG_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
