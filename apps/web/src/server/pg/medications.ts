import "server-only";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts, zonedToUtc } from "@medcuidar/domain";
import type { ControlUnit, MedRoute } from "@medcuidar/shared";
import { validateScheme, type PhaseInput } from "@/lib/scheme";
import { audit } from "./audit";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";
import { evaluateLowStock, getOrCreateStockItem, refreshBalance } from "./stock";

export interface MedicationData {
  patientId: string;
  name: string;
  alternatives: string[];
  route: MedRoute;
  controlUnit: ControlUnit;
  dropsPerMl?: number;
  /** Estoque inicial (compra de abertura). Exige a permissão de estoque. */
  initialStock?: number;
  /** Exige receita (Lote 3). Padrão: não exige (quem cadastra marca no formulário). */
  requiresPrescription?: boolean;
}

const DEFAULT_DROPS_PER_ML = 20;

/**
 * Cadastra um remédio para um paciente. No Lote 1 cada remédio nasce com UM tratamento (paciente × remédio) e
 * um esquema inicial de 1 vez ao dia, às 08:00, que se ajusta em Esquemas.
 */
export async function createMedication(actor: Actor, input: MedicationData): Promise<string> {
  requirePermission(actor, "medications.manage");
  const initial = input.initialStock ?? 0;
  if (initial !== 0) {
    requirePermission(actor, "stock.adjust");
    if (!Number.isFinite(initial) || initial < 0 || initial > 100_000) throw new UserError("Informe um estoque inicial válido (zero ou mais).");
  }
  return withFamilia(actor.familyId, async (tx) => {
    const [patient] = await tx.select({ id: s.patients.id }).from(s.patients).where(and(eq(s.patients.id, input.patientId), isNull(s.patients.deletedAt)));
    if (!patient) throw new UserError("Paciente não encontrado.");
    const [med] = await tx
      .insert(s.medications)
      .values({
        familyId: actor.familyId,
        name: input.name,
        alternativeNames: input.alternatives,
        route: input.route,
        controlUnit: input.controlUnit,
        dropsPerMl: input.controlUnit === "drop" ? (input.dropsPerMl ?? DEFAULT_DROPS_PER_ML) : null,
        requiresPrescription: input.requiresPrescription ?? false,
      })
      .returning({ id: s.medications.id });
    const [t] = await tx
      .insert(s.treatments)
      .values({ familyId: actor.familyId, patientId: input.patientId, medicationId: med!.id, startDate: localParts(new Date(), actor.timezone).date })
      .returning({ id: s.treatments.id });
    await tx.insert(s.treatmentPhases).values({
      familyId: actor.familyId, treatmentId: t!.id, order: 1, startDay: 1, endDay: null, scheduleType: "interval", intervalHours: 24, firstDoseTime: "08:00", doseAmount: 1,
    });
    await audit(tx, actor, "medication.create", "medication", med!.id);
    if (initial > 0) {
      const item = await getOrCreateStockItem(tx, actor.familyId, med!.id);
      await tx.insert(s.stockMovements).values({ familyId: actor.familyId, stockItemId: item.id, type: "purchase", quantity: initial, createdByMemberId: actor.memberId, note: "Saldo inicial" });
      await refreshBalance(tx, item.id);
      await audit(tx, actor, "stock.purchase", "stock_item", item.id, { quantity: initial });
      await evaluateLowStock(tx, actor.familyId, item.id, new Date());
    }
    return med!.id;
  });
}

export interface MedicationChanges {
  name?: string;
  alternatives?: string[];
  route?: MedRoute;
  controlUnit?: ControlUnit;
  dropsPerMl?: number;
  requiresPrescription?: boolean;
}

export async function updateMedication(actor: Actor, medicationId: string, patch: MedicationChanges): Promise<void> {
  requirePermission(actor, "medications.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const [cur] = await tx.select().from(s.medications).where(and(eq(s.medications.id, medicationId), isNull(s.medications.deletedAt)));
    if (!cur) throw new UserError("Remédio não encontrado.");
    const unit = patch.controlUnit ?? cur.controlUnit;
    await tx
      .update(s.medications)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.alternatives !== undefined ? { alternativeNames: patch.alternatives } : {}),
        ...(patch.route !== undefined ? { route: patch.route } : {}),
        ...(patch.requiresPrescription !== undefined ? { requiresPrescription: patch.requiresPrescription } : {}),
        controlUnit: unit,
        dropsPerMl: unit === "drop" ? (patch.dropsPerMl ?? cur.dropsPerMl ?? DEFAULT_DROPS_PER_ML) : null,
      })
      .where(eq(s.medications.id, medicationId));
    await audit(tx, actor, "medication.update", "medication", medicationId);
  });
}

/** Exclusão lógica (com "Desfazer"): o remédio e o tratamento somem das telas; o histórico fica guardado. */
export async function deleteMedication(actor: Actor, medicationId: string): Promise<void> {
  requirePermission(actor, "medications.manage");
  await setDeleted(actor, medicationId, new Date(), "medication.delete");
}
export async function restoreMedication(actor: Actor, medicationId: string): Promise<void> {
  requirePermission(actor, "medications.manage");
  await setDeleted(actor, medicationId, null, "medication.restore");
}

async function setDeleted(actor: Actor, medicationId: string, at: Date | null, action: string) {
  await withFamilia(actor.familyId, async (tx) => {
    const rows = await tx.update(s.medications).set({ deletedAt: at }).where(eq(s.medications.id, medicationId)).returning({ id: s.medications.id });
    if (!rows.length) throw new UserError("Remédio não encontrado.");
    await tx.update(s.treatments).set({ deletedAt: at }).where(eq(s.treatments.medicationId, medicationId));
    await audit(tx, actor, action, "medication", medicationId);
  });
}

export interface SchemeData {
  /** aaaa-mm-dd: dia 1 do esquema (omitido = mantém) */
  startDate?: string;
  firstTime: string;
  phases: PhaseInput[];
}

/** Grava o esquema (fases) do remédio. As regras de fases são as do domínio (lib/scheme.ts) e valem no servidor. */
export async function saveScheme(actor: Actor, medicationId: string, input: SchemeData): Promise<void> {
  requirePermission(actor, "treatments.manage");
  const check = validateScheme(input.phases, input.firstTime);
  if (!check.ok) throw new UserError(check.errors[0]!);
  await withFamilia(actor.familyId, async (tx) => {
    const [t] = await tx.select().from(s.treatments).where(and(eq(s.treatments.medicationId, medicationId), isNull(s.treatments.deletedAt)));
    if (!t) throw new UserError("Remédio não encontrado.");
    if (input.startDate) await tx.update(s.treatments).set({ startDate: input.startDate }).where(eq(s.treatments.id, t.id));
    await tx.delete(s.treatmentPhases).where(eq(s.treatmentPhases.treatmentId, t.id));
    await tx.insert(s.treatmentPhases).values(
      input.phases.map((p, i) => ({
        familyId: actor.familyId,
        treatmentId: t.id,
        order: i + 1,
        startDay: p.fromDay,
        endDay: p.toDay,
        scheduleType: "interval" as const,
        intervalHours: p.everyHours,
        firstDoseTime: input.firstTime,
        doseAmount: p.perDose,
      })),
    );
    // Refaz as doses ainda não tocadas (sem check, sem movimento de estoque):
    //  - remédio já em uso (alguma dose tomada): só as que ainda não chegaram;
    //  - remédio recém-cadastrado, ainda sem nenhuma dose tomada: o esquema ainda está sendo montado, então vale desde
    //    o começo de hoje (assim a dose do esquema padrão das 08:00 não sobra como "esquecida").
    // A rotina do dia gera de novo as doses do esquema novo; doses tomadas e o histórico ficam como estão.
    const [used] = await tx.select({ id: s.doseEvents.id }).from(s.doseEvents).where(and(eq(s.doseEvents.treatmentId, t.id), eq(s.doseEvents.status, "taken"))).limit(1);
    const now = new Date();
    const cutoff = used ? now : zonedToUtc(localParts(now, actor.timezone).date, 0, actor.timezone);
    await tx.delete(s.doseEvents).where(and(
      eq(s.doseEvents.treatmentId, t.id), inArray(s.doseEvents.status, used ? ["pending"] : ["pending", "late", "missed"]), gt(s.doseEvents.scheduledAt, new Date(cutoff.getTime() - (used ? 0 : 1))),
      sql`${s.doseEvents.id} not in (select dose_event_id from stock_movements where dose_event_id is not null)`,
    ));
    await audit(tx, actor, "scheme.save", "treatment", t.id, { phases: input.phases.length });
    const [item] = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.patientId, t.patientId), eq(s.stockItems.medicationId, medicationId)));
    if (item) await evaluateLowStock(tx, actor.familyId, item.id, new Date());
  });
}
