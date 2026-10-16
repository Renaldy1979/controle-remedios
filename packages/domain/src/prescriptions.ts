import type { Treatment } from "./types";
import { addDays, daysBetween } from "./time";

export type ReplenishmentStatus = "needs_prescription" | "prescription_received" | "purchased" | "done" | "cancelled";
export type PrescriptionStatus = "valid" | "expired" | "awaiting_new" | "superseded";

export interface PrescriptionInfo {
  status: PrescriptionStatus;
  /** Dias até vencer (só para `valid` com validade); negativo/ausente caso contrário. */
  expiresInDays: number | null;
  /** `valid` e faltam ≤ 15 dias. */
  expiringSoon: boolean;
  noValidityInformed: boolean;
}

export const EXPIRING_SOON_DAYS = 15;

/**
 * Situação da receita (docs/02 e design 6):
 * substituta → superseded; pedido pendente → awaiting_new; emissão + validade < hoje → expired; senão valid.
 * `validUntil` é a data de fim da validade (YYYY-MM-DD); sem validade = valid.
 */
export function prescriptionStatus(
  issuedOn: string,
  validUntil: string | null | undefined,
  today: string,
  opts: { supersededById?: string | null; hasPendingRequest?: boolean } = {},
): PrescriptionInfo {
  void issuedOn; // emissão só participa quando a validade vem em dias (ver validUntilFromDays)
  if (opts.supersededById) return { status: "superseded", expiresInDays: null, expiringSoon: false, noValidityInformed: false };
  if (opts.hasPendingRequest) return { status: "awaiting_new", expiresInDays: null, expiringSoon: false, noValidityInformed: false };
  if (!validUntil) return { status: "valid", expiresInDays: null, expiringSoon: false, noValidityInformed: true };
  const left = daysBetween(today, validUntil);
  if (left < 0) return { status: "expired", expiresInDays: left, expiringSoon: false, noValidityInformed: false };
  return { status: "valid", expiresInDays: left, expiringSoon: left <= EXPIRING_SOON_DAYS, noValidityInformed: false };
}

/** Converte "emissão + N dias de validade" em data final. */
export function validUntilFromDays(issuedOn: string, validityDays: number): string {
  return addDays(issuedOn, validityDays);
}

export interface PrescriptionRef {
  id: string;
  patient_id: string;
  status: PrescriptionStatus;
  medication_ids: string[];
  valid_until?: string | null;
  issued_on?: string;
}

/** Há receita vigente do paciente cobrindo o remédio do tratamento? Remédio sem exigência de receita sempre cobre. */
export function isCoverageValid(
  treatment: Pick<Treatment, "patient_id" | "medication_id">,
  prescriptions: PrescriptionRef[],
  opts: { requiresPrescription?: boolean; today?: string } = {},
): boolean {
  if (opts.requiresPrescription === false) return true;
  return prescriptions.some(
    (p) =>
      p.patient_id === treatment.patient_id &&
      p.status === "valid" &&
      p.medication_ids.includes(treatment.medication_id) &&
      (!opts.today || !p.valid_until || p.valid_until >= opts.today),
  );
}

export type MedicationPrescriptionState = "valid" | "awaiting" | "not_needed" | "expired" | "none";

/** Receita de um remédio: vigente mais recente; senão aguardando; senão "não precisa"; senão vencida; senão sem receita. */
export function medicationPrescriptionState(
  medicationId: string,
  prescriptions: PrescriptionRef[],
  requiresPrescription = true,
): { state: MedicationPrescriptionState; prescription: PrescriptionRef | null } {
  const mine = prescriptions.filter((p) => p.medication_ids.includes(medicationId));
  const latest = (list: PrescriptionRef[]) =>
    [...list].sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? ""))[0] ?? null;
  const valid = latest(mine.filter((p) => p.status === "valid"));
  if (valid) return { state: "valid", prescription: valid };
  const awaiting = latest(mine.filter((p) => p.status === "awaiting_new"));
  if (awaiting) return { state: "awaiting", prescription: awaiting };
  if (!requiresPrescription) return { state: "not_needed", prescription: null };
  const expired = latest(mine.filter((p) => p.status === "expired"));
  if (expired) return { state: "expired", prescription: expired };
  return { state: "none", prescription: null };
}

/**
 * Ao salvar receita nova: ids das receitas do mesmo paciente (vencidas ou aguardando) com remédio em comum
 * que passam a `superseded`.
 */
export function prescriptionsToSupersede(
  created: Pick<PrescriptionRef, "patient_id" | "medication_ids" | "id">,
  existing: PrescriptionRef[],
): string[] {
  return existing
    .filter(
      (p) =>
        p.id !== created.id &&
        p.patient_id === created.patient_id &&
        (p.status === "expired" || p.status === "awaiting_new") &&
        p.medication_ids.some((m) => created.medication_ids.includes(m)),
    )
    .map((p) => p.id);
}
