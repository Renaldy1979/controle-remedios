/**
 * Validação do esquema de um remédio (fases). Roda no navegador (feedback imediato) e no servidor (a verdade).
 * As regras de "qual fase vale em cada dia" e "quantas doses por dia" vêm de @medcuidar/domain.
 */
import { DEFAULT_TZ, generateDoseEvents, localParts, phaseForDay, type Treatment, type TreatmentPhase } from "@medcuidar/domain";

export const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export const MAX_PHASES = 6;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface PhaseInput {
  everyHours: number;
  fromDay: number;
  /** null = até acabar (só a última fase) */
  toDay: number | null;
  perDose: number;
}

export interface SchemeCheck {
  ok: boolean;
  errors: string[];
}

const toDomain = (phases: PhaseInput[], firstTime: string): TreatmentPhase[] =>
  phases.map((p, i) => ({
    id: `p${i + 1}`,
    treatment_id: "t",
    order: i + 1,
    start_day: p.fromDay,
    end_day: p.toDay,
    schedule_type: "interval" as const,
    interval_hours: p.everyHours,
    first_dose_time: firstTime,
    times: null,
    dose_amount: p.perDose,
  }));

export function validateScheme(phases: PhaseInput[], firstTime: string): SchemeCheck {
  const errors: string[] = [];
  if (!HHMM.test(firstTime)) errors.push("Use o primeiro horário no formato 24h, por exemplo 08:00.");
  if (phases.length === 0) errors.push("Inclua ao menos uma fase.");
  if (phases.length > MAX_PHASES) errors.push(`Use no máximo ${MAX_PHASES} fases.`);
  if (errors.length) return { ok: false, errors };

  phases.forEach((p, i) => {
    const n = i + 1;
    if (!Number.isFinite(p.everyHours) || p.everyHours <= 0 || p.everyHours > 24) errors.push(`Fase ${n}: informe de quantas em quantas horas (de 1 a 24).`);
    if (!Number.isFinite(p.perDose) || p.perDose <= 0 || p.perDose > 1000) errors.push(`Fase ${n}: a quantidade por dose precisa ser maior que zero.`);
    if (!Number.isInteger(p.fromDay) || p.fromDay < 1) errors.push(`Fase ${n}: o dia inicial precisa ser 1 ou mais.`);
    if (p.toDay !== null && (!Number.isInteger(p.toDay) || p.toDay < p.fromDay)) errors.push(`Fase ${n}: o dia final não pode ser antes do dia inicial.`);
    if (p.toDay === null && i < phases.length - 1) errors.push(`Fase ${n}: só a última fase pode ficar sem dia final.`);
  });
  if (errors.length) return { ok: false, errors };

  if (phases[0]!.fromDay !== 1) errors.push("A primeira fase precisa começar no dia 1.");
  for (let i = 1; i < phases.length; i++) {
    const prev = phases[i - 1]!;
    const cur = phases[i]!;
    if (cur.fromDay <= prev.toDay!) errors.push(`Fase ${i + 1}: começa no dia ${cur.fromDay}, mas a fase ${i} vai até o dia ${prev.toDay}. As fases não podem se sobrepor.`);
    else if (cur.fromDay > prev.toDay! + 1) errors.push(`Fase ${i + 1}: falta cobrir o dia ${prev.toDay! + 1} até o dia ${cur.fromDay - 1}. Comece a fase no dia ${prev.toDay! + 1}.`);
  }
  if (errors.length) return { ok: false, errors };

  // Confere com o domínio: cada dia cai exatamente na fase esperada.
  const dom = toDomain(phases, firstTime);
  dom.forEach((d, i) => {
    if (phaseForDay(dom, d.start_day)?.order !== i + 1) errors.push(`Fase ${i + 1}: as datas se confundem com outra fase.`);
  });
  return { ok: errors.length === 0, errors };
}

export interface SchemeDose {
  /** HH:mm no fuso do sistema */
  time: string;
  perDose: number;
  phase: number;
}

/**
 * Doses que o esquema gera num dia (aaaa-mm-dd), pelo mesmo cálculo do servidor (intervalo contínuo, com a
 * hora de início da fase 1 como âncora). Usado pela prévia do formulário e pelo calendário.
 */
export function schemeDosesOnDate(args: { startDate: string; firstTime: string; phases: PhaseInput[]; date: string; tz?: string }): SchemeDose[] {
  const tz = args.tz ?? DEFAULT_TZ;
  if (!HHMM.test(args.firstTime) || args.phases.length === 0) return [];
  const dom = toDomain(args.phases, args.firstTime);
  const treatment: Treatment = { id: "t", family_id: "f", patient_id: "p", medication_id: "m", start_date: args.startDate, status: "active" };
  return generateDoseEvents(treatment, dom, args.date, tz).map((d) => {
    const mins = localParts(new Date(d.scheduled_at), tz).minutes;
    return { time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`, perDose: d.amount, phase: dom.find((p) => p.id === d.phase_id)?.order ?? 1 };
  });
}
