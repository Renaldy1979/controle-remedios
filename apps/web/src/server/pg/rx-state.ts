import { prescriptionStatus, type PrescriptionInfo, type PrescriptionRef } from "@medcuidar/domain";

/** Pedido de receita em andamento: reposição aberta, etapa 1 ("pedir ao médico") feita e a 2 ("recebida") ainda não. */
export interface PendingRequest {
  patientId: string;
  medicationId: string;
}

export interface RxRow {
  id: string;
  patientId: string;
  issuedOn: string;
  validUntil: string | null;
  status: "valid" | "expired" | "awaiting_new" | "superseded";
  supersededById: string | null;
}

/** Situação calculada pelo domínio (vigente, vence em ≤ 15 dias, vencida, aguardando nova, substituída). Nunca gravada: depende de hoje. */
export function rxInfo(rx: RxRow, medicationIds: string[], pending: PendingRequest[], today: string): PrescriptionInfo {
  const hasPendingRequest =
    rx.status === "awaiting_new" || pending.some((p) => p.patientId === rx.patientId && medicationIds.includes(p.medicationId));
  return prescriptionStatus(rx.issuedOn, rx.validUntil, today, {
    supersededById: rx.supersededById ?? (rx.status === "superseded" ? "manual" : null),
    hasPendingRequest,
  });
}

export const rxRef = (rx: RxRow, medicationIds: string[], pending: PendingRequest[], today: string): PrescriptionRef => ({
  id: rx.id,
  patient_id: rx.patientId,
  status: rxInfo(rx, medicationIds, pending, today).status,
  medication_ids: medicationIds,
  valid_until: rx.validUntil,
  issued_on: rx.issuedOn,
});
