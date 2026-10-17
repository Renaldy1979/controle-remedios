import type { CareAssignment, DoseEvent, Member, StockMovement, Treatment, TreatmentPhase } from "@medcuidar/domain";
import type { Row } from "../ports";
import { n, s, sOpt } from "../rows";

/** Linhas do banco → tipos estruturais do domínio. Datas de dia (`YYYY-MM-DD`) aceitam ISO completo. */
export const dateOnly = (v: unknown): string => String(v ?? "").slice(0, 10);

export const toTreatment = (r: Row): Treatment => ({
  id: r.$id,
  family_id: s(r, "family_id"),
  patient_id: s(r, "patient_id"),
  medication_id: s(r, "medication_id"),
  start_date: dateOnly(r["start_date"]),
  end_date: r["end_date"] ? dateOnly(r["end_date"]) : null,
  status: s(r, "status") as Treatment["status"],
  low_stock_days: r["low_stock_days"] === null || r["low_stock_days"] === undefined ? null : n(r, "low_stock_days"),
});

export const toPhase = (r: Row): TreatmentPhase => ({
  id: r.$id,
  treatment_id: s(r, "treatment_id"),
  order: n(r, "order"),
  start_day: n(r, "start_day"),
  end_day: r["end_day"] === null || r["end_day"] === undefined ? null : n(r, "end_day"),
  schedule_type: s(r, "schedule_type") as TreatmentPhase["schedule_type"],
  interval_hours: r["interval_hours"] === null || r["interval_hours"] === undefined ? null : n(r, "interval_hours"),
  first_dose_time: sOpt(r, "first_dose_time") ?? null,
  times: Array.isArray(r["times"]) ? (r["times"] as string[]) : null,
  dose_amount: n(r, "dose_amount"),
});

export const toDose = (r: Row): DoseEvent => ({
  id: r.$id,
  family_id: s(r, "family_id"),
  treatment_id: s(r, "treatment_id"),
  patient_id: s(r, "patient_id"),
  medication_id: s(r, "medication_id"),
  scheduled_at: s(r, "scheduled_at"),
  status: s(r, "status") as DoseEvent["status"],
  confirmed_by_member_id: sOpt(r, "confirmed_by_member_id") ?? null,
  confirmed_at: sOpt(r, "confirmed_at") ?? null,
  channel: (sOpt(r, "channel") as DoseEvent["channel"]) ?? null,
  source_message_id: sOpt(r, "source_message_id") ?? null,
  amount: n(r, "amount"),
  phase_id: sOpt(r, "phase_id") ?? null,
});

export const toMovement = (r: Row): StockMovement => ({
  id: r.$id,
  family_id: s(r, "family_id"),
  stock_item_id: s(r, "stock_item_id"),
  type: s(r, "type") as StockMovement["type"],
  quantity: n(r, "quantity"),
  dose_event_id: sOpt(r, "dose_event_id") ?? null,
  replenishment_id: sOpt(r, "replenishment_id") ?? null,
  created_by_member_id: sOpt(r, "created_by_member_id") ?? null,
  note: sOpt(r, "note") ?? null,
});

export const toMember = (r: Row): Member => ({
  id: r.$id,
  name: s(r, "name"),
  active: r["active"] !== false,
  receives_family_alerts: r["receives_family_alerts"] === true,
});

export const toAssignment = (r: Row): CareAssignment => ({
  member_id: s(r, "member_id"),
  weekdays: Array.isArray(r["weekdays"]) ? (r["weekdays"] as number[]).map(Number) : [],
  start_time: s(r, "start_time"),
  end_time: s(r, "end_time"),
  priority: n(r, "priority"),
});

/** Dados para gravar: sem `undefined` e sem campos nulos opcionais (índices únicos ignoram o ausente). */
export function clean(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}
