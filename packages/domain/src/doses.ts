import type { FamilySettings } from "@medcuidar/shared";
import { addDays, daysBetween, parseHHmm, zonedToUtc, DEFAULT_TZ } from "./time";
import type { DoseEvent, StockMovement, Treatment, TreatmentPhase } from "./types";

export interface DoseDraft {
  family_id: string;
  treatment_id: string;
  patient_id: string;
  medication_id: string;
  scheduled_at: string;
  status: "pending";
  amount: number;
  phase_id: string;
  /** Chave de idempotência = índice único (treatment_id, scheduled_at). */
  key: string;
}

/** Fase vigente no dia (1-based) do tratamento. */
export function phaseForDay(phases: TreatmentPhase[], day: number): TreatmentPhase | undefined {
  return [...phases]
    .sort((a, b) => a.order - b.order)
    .find((p) => day >= p.start_day && (p.end_day === null || day <= p.end_day));
}

/**
 * Doses por dia em média (sem contar horário de verão). Intervalo contínuo: 24 h / intervalo,
 * então um intervalo de 5 h dá 4,8 por dia (4 ou 5 doses conforme o dia).
 */
export function dosesPerDay(phase: TreatmentPhase): number {
  if (phase.schedule_type === "fixed_times") return new Set(phase.times ?? []).size;
  const hours = phase.interval_hours ?? 0;
  return hours > 0 ? 24 / hours : 0;
}

/**
 * Doses de um dia local (YYYY-MM-DD). Idempotente: mesmo resultado a cada chamada;
 * `existing` (scheduled_at já gravados) é descartado.
 *
 * Intervalo CONTÍNUO: a âncora é o dia 1 + `first_dose_time` da primeira fase. Cada fase de intervalo começa
 * no seu `start_day` no horário da âncora e gera doses a cada `interval_hours`, atravessando a meia-noite, até o
 * fim do seu último dia (`end_day`; nulo = sem fim). Os intervalos contam em tempo real, então a troca de
 * horário de verão não duplica nem pula doses.
 */
export function generateDoseEvents(
  treatment: Treatment,
  phases: TreatmentPhase[],
  date: string,
  tz: string = DEFAULT_TZ,
  existing: Array<{ scheduled_at: string }> = [],
): DoseDraft[] {
  if (treatment.status !== "active") return [];
  if (date < treatment.start_date) return [];
  if (treatment.end_date && date > treatment.end_date) return [];
  const day = daysBetween(treatment.start_date, date) + 1;
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  const anchorTime = parseHHmm(sorted.find((p) => p.schedule_type === "interval")?.first_dose_time ?? "00:00");
  const dayStart = zonedToUtc(date, 0, tz).getTime();
  const dayEnd = zonedToUtc(addDays(date, 1), 0, tz).getTime();

  const drafts: Array<{ at: Date; phase: TreatmentPhase }> = [];
  if (phaseForDay(sorted, day)?.schedule_type === "fixed_times") {
    const phase = phaseForDay(sorted, day)!;
    for (const t of new Set(phase.times ?? [])) drafts.push({ at: zonedToUtc(date, parseHHmm(t), tz), phase });
  }
  for (const phase of sorted) {
    if (phase.schedule_type !== "interval") continue;
    const step = (phase.interval_hours ?? 0) * 3600_000;
    if (step <= 0) continue;
    const from = zonedToUtc(addDays(treatment.start_date, phase.start_day - 1), anchorTime, tz).getTime();
    const until = phase.end_day === null ? Infinity : zonedToUtc(addDays(treatment.start_date, phase.end_day), anchorTime, tz).getTime();
    if (from >= dayEnd || until <= dayStart) continue;
    for (let t = from + Math.max(0, Math.ceil((dayStart - from) / step)) * step; t < dayEnd && t < until; t += step) {
      if (t >= dayStart) drafts.push({ at: new Date(t), phase });
    }
  }

  const have = new Set(existing.map((e) => new Date(e.scheduled_at).toISOString()));
  const seen = new Set<string>();
  return drafts
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((d) => {
      const iso = d.at.toISOString();
      if (seen.has(iso) || have.has(iso)) return false;
      seen.add(iso);
      return true;
    })
    .map(({ at, phase }) => ({
      family_id: treatment.family_id,
      treatment_id: treatment.id,
      patient_id: treatment.patient_id,
      medication_id: treatment.medication_id,
      scheduled_at: at.toISOString(),
      status: "pending" as const,
      amount: phase.dose_amount,
      phase_id: phase.id,
      key: `${treatment.id}|${at.toISOString()}`,
    }));
}

/* ---------- confirmação ---------- */

/** Portas de persistência (implementadas sobre FamilyScopedDb fora deste pacote). */
export interface ConfirmDoseRepo {
  getDose(id: string): Promise<DoseEvent | null>;
  findDoseBySourceMessage(sourceMessageId: string): Promise<DoseEvent | null>;
  findStockItemId(patientId: string, medicationId: string): Promise<string | null>;
  /** Movimentos ligados à dose: o original (`dose_event_id`) e as compensações `undo:`/`redo:<doseId>…` (campo `note`). */
  listDoseMovements(doseId: string): Promise<StockMovement[]>;
  /** Insere movimento comum (compensação/refazer). */
  insertMovement(movement: StockMovement): Promise<void>;
  /** Insere o movimento só se não existir um para `dose_event_id` (índice único). Retorna true se criou. */
  insertDoseMovementIfAbsent(movement: StockMovement): Promise<boolean>;
  /** Marca a dose como tomada; devolve a dose atualizada. */
  markTaken(
    doseId: string,
    patch: {
      confirmed_by_member_id: string;
      confirmed_at: string;
      channel: "whatsapp" | "panel" | "system";
      source_message_id?: string | null;
    },
  ): Promise<DoseEvent>;
}

export interface ConfirmDoseInput {
  doseId: string;
  memberId: string;
  channel: "whatsapp" | "panel" | "system";
  sourceMessageId?: string | null;
  now: Date;
}

export type ConfirmDoseResult =
  | { result: "confirmed"; dose: DoseEvent; stockDeducted: boolean }
  | { result: "duplicate"; dose: DoseEvent }
  | { result: "not_found" }
  | { result: "not_confirmable"; dose: DoseEvent };

/**
 * Confirma uma dose. Idempotente: a mesma mensagem (source_message_id) ou uma dose já tomada
 * nunca desconta duas vezes. Ordem segura sem transação: movimento (único por dose) → dose tomada;
 * se cair no meio, repetir completa o que faltou sem duplicar.
 */
export async function confirmDose(repo: ConfirmDoseRepo, input: ConfirmDoseInput): Promise<ConfirmDoseResult> {
  if (input.sourceMessageId) {
    const prior = await repo.findDoseBySourceMessage(input.sourceMessageId);
    if (prior) return { result: "duplicate", dose: prior };
  }
  const dose = await repo.getDose(input.doseId);
  if (!dose) return { result: "not_found" };
  if (dose.status === "taken") return { result: "duplicate", dose };
  if (dose.status === "skipped") return { result: "not_confirmable", dose };

  const stockItemId = await repo.findStockItemId(dose.patient_id, dose.medication_id);
  let stockDeducted = false;
  if (stockItemId) {
    // Saldo líquido da dose: o desconto original existe uma só vez (índice único); após um "desfazer"
    // o líquido volta a 0 e a reconfirmação desconta de novo com um movimento `redo`.
    const existing = await repo.listDoseMovements(dose.id);
    if (existing.length === 0) {
      stockDeducted = await repo.insertDoseMovementIfAbsent({
        family_id: dose.family_id,
        stock_item_id: stockItemId,
        type: "dose",
        quantity: -dose.amount,
        dose_event_id: dose.id,
        created_by_member_id: input.memberId,
      });
    } else if (netOf(existing) === 0) {
      const seq = existing.filter((m) => m.note?.startsWith(`undo:${dose.id}`)).length;
      await repo.insertMovement({
        family_id: dose.family_id,
        stock_item_id: stockItemId,
        type: "adjustment",
        quantity: -dose.amount,
        created_by_member_id: input.memberId,
        note: `redo:${dose.id}:${seq}`,
      });
      stockDeducted = true;
    }
  }
  const updated = await repo.markTaken(dose.id, {
    confirmed_by_member_id: input.memberId,
    confirmed_at: input.now.toISOString(),
    channel: input.channel,
    source_message_id: input.sourceMessageId ?? null,
  });
  return { result: "confirmed", dose: updated, stockDeducted };
}

const netOf = (list: StockMovement[]) => Math.round(list.reduce((a, m) => a + m.quantity, 0) * 1000) / 1000;

/* ---------- desfazer ---------- */

export interface UndoDoseRepo {
  getDose(id: string): Promise<DoseEvent | null>;
  findStockItemId(patientId: string, medicationId: string): Promise<string | null>;
  listDoseMovements(doseId: string): Promise<StockMovement[]>;
  insertMovement(movement: StockMovement): Promise<void>;
  /** Volta a dose ao status e limpa confirmed_by/at/channel/source_message_id. */
  resetDose(doseId: string, status: "pending" | "late" | "missed"): Promise<DoseEvent>;
}

export type UndoDoseResult =
  | { result: "undone"; dose: DoseEvent; stockRestored: boolean }
  | { result: "not_found" }
  | { result: "not_taken"; dose: DoseEvent };

/**
 * Desfaz a confirmação. O prazo (8 s) é da interface. O estoque volta com um movimento `adjustment`
 * positivo (`note: undo:<doseId>:<n>`), pois o movimento original é único por dose e não é apagado.
 * Idempotente: só compensa se o líquido da dose ainda for negativo.
 */
export async function undoDoseConfirmation(
  repo: UndoDoseRepo,
  input: {
    doseId: string;
    memberId: string;
    now: Date;
    settings?: Pick<FamilySettings, "late_after_min" | "missed_after_min">;
  },
): Promise<UndoDoseResult> {
  const dose = await repo.getDose(input.doseId);
  if (!dose) return { result: "not_found" };
  if (dose.status !== "taken") return { result: "not_taken", dose };

  let stockRestored = false;
  const stockItemId = await repo.findStockItemId(dose.patient_id, dose.medication_id);
  if (stockItemId) {
    const existing = await repo.listDoseMovements(dose.id);
    const net = netOf(existing);
    if (net < 0) {
      const seq = existing.filter((m) => m.note?.startsWith(`undo:${dose.id}`)).length;
      await repo.insertMovement({
        family_id: dose.family_id,
        stock_item_id: stockItemId,
        type: "adjustment",
        quantity: -net,
        created_by_member_id: input.memberId,
        note: `undo:${dose.id}:${seq}`,
      });
      stockRestored = true;
    }
  }
  const late = input.settings?.late_after_min ?? 15;
  const missed = input.settings?.missed_after_min ?? 120;
  const elapsed = (input.now.getTime() - new Date(dose.scheduled_at).getTime()) / 60000;
  const status = elapsed >= missed ? "missed" : elapsed >= late ? "late" : "pending";
  return { result: "undone", dose: await repo.resetDose(dose.id, status), stockRestored };
}

/* ---------- atraso / esquecida ---------- */

export interface DoseStatusChange {
  doseId: string;
  from: "pending" | "late";
  to: "late" | "missed";
  /** Esquecida avisa a família. */
  notifyFamily: boolean;
}

export function markLateAndMissed(
  now: Date,
  settings: Pick<FamilySettings, "late_after_min" | "missed_after_min">,
  doses: Array<Pick<DoseEvent, "id" | "status" | "scheduled_at">>,
): DoseStatusChange[] {
  const changes: DoseStatusChange[] = [];
  for (const d of doses) {
    if (d.status !== "pending" && d.status !== "late") continue;
    const elapsedMin = (now.getTime() - new Date(d.scheduled_at).getTime()) / 60000;
    if (elapsedMin >= settings.missed_after_min) {
      changes.push({ doseId: d.id, from: d.status, to: "missed", notifyFamily: true });
    } else if (d.status === "pending" && elapsedMin >= settings.late_after_min) {
      changes.push({ doseId: d.id, from: "pending", to: "late", notifyFamily: false });
    }
  }
  return changes;
}
