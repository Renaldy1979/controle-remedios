import type { FamilySettings } from "@medcuidar/shared";
import { daysBetween, localParts, parseHHmm, zonedToUtc, DEFAULT_TZ } from "./time";
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

/** Número de doses que a fase gera num dia (sem contar horário de verão). */
export function dosesPerDay(phase: TreatmentPhase): number {
  if (phase.schedule_type === "fixed_times") return new Set(phase.times ?? []).size;
  const step = (phase.interval_hours ?? 0) * 60;
  if (step <= 0) return 0;
  const first = parseHHmm(phase.first_dose_time ?? "00:00");
  return Math.floor((1440 - 1 - first) / step) + 1;
}

/**
 * Doses de um dia local (YYYY-MM-DD). Idempotente: mesmo resultado a cada chamada;
 * `existing` (scheduled_at já gravados) é descartado. Intervalos contam em tempo real
 * a partir da primeira dose, então a troca de horário de verão não duplica nem pula doses.
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
  const phase = phaseForDay(phases, day);
  if (!phase) return [];

  const instants: Date[] = [];
  if (phase.schedule_type === "fixed_times") {
    for (const t of new Set(phase.times ?? [])) instants.push(zonedToUtc(date, parseHHmm(t), tz));
  } else {
    const step = (phase.interval_hours ?? 0) * 3600_000;
    if (step <= 0) return [];
    let cur = zonedToUtc(date, parseHHmm(phase.first_dose_time ?? "00:00"), tz);
    while (localParts(cur, tz).date === date) {
      instants.push(cur);
      cur = new Date(cur.getTime() + step);
    }
  }

  const have = new Set(existing.map((e) => new Date(e.scheduled_at).toISOString()));
  return instants
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d) => d.toISOString())
    .filter((iso, i, arr) => arr.indexOf(iso) === i && !have.has(iso))
    .map((iso) => ({
      family_id: treatment.family_id,
      treatment_id: treatment.id,
      patient_id: treatment.patient_id,
      medication_id: treatment.medication_id,
      scheduled_at: iso,
      status: "pending" as const,
      amount: phase.dose_amount,
      phase_id: phase.id,
      key: `${treatment.id}|${iso}`,
    }));
}

/* ---------- confirmação ---------- */

/** Portas de persistência (implementadas sobre FamilyScopedDb fora deste pacote). */
export interface ConfirmDoseRepo {
  getDose(id: string): Promise<DoseEvent | null>;
  findDoseBySourceMessage(sourceMessageId: string): Promise<DoseEvent | null>;
  findStockItemId(patientId: string, medicationId: string): Promise<string | null>;
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
    stockDeducted = await repo.insertDoseMovementIfAbsent({
      family_id: dose.family_id,
      stock_item_id: stockItemId,
      type: "dose",
      quantity: -dose.amount,
      dose_event_id: dose.id,
      created_by_member_id: input.memberId,
    });
  }
  const updated = await repo.markTaken(dose.id, {
    confirmed_by_member_id: input.memberId,
    confirmed_at: input.now.toISOString(),
    channel: input.channel,
    source_message_id: input.sourceMessageId ?? null,
  });
  return { result: "confirmed", dose: updated, stockDeducted };
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
