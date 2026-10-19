import * as s from "@medcuidar/pg/schema";
import type { Treatment, TreatmentPhase } from "@medcuidar/domain";

/** Linhas do Drizzle (camelCase, Date) → tipos do domínio (snake_case, ISO). */
export const toDomainPhase = (p: typeof s.treatmentPhases.$inferSelect): TreatmentPhase => ({
  id: p.id, treatment_id: p.treatmentId, order: p.order, start_day: p.startDay, end_day: p.endDay,
  schedule_type: p.scheduleType, interval_hours: p.intervalHours, first_dose_time: p.firstDoseTime, times: p.times, dose_amount: p.doseAmount,
});

export const toDomainTreatment = (t: typeof s.treatments.$inferSelect): Treatment => ({
  id: t.id, family_id: t.familyId, patient_id: t.patientId, medication_id: t.medicationId,
  start_date: t.startDate, end_date: t.endDate, status: t.status, low_stock_days: t.lowStockDays,
});
