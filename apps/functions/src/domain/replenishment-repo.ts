import {
  openReplenishment,
  type Replenishment,
  type ReplenishmentStep,
  type StepNumber,
} from "@medcuidar/domain";
import type { FamilyData, Row } from "../ports";
import { isConflict, n, s, sOpt } from "../rows";

export interface LoadedReplenishment {
  row: Row;
  repl: Replenishment;
  patientId: string;
  medicationId: string;
  requiresPrescription: boolean;
}

const STEPS: StepNumber[] = [1, 2, 3, 4];

/** Reposição = linha de `replenishments` + até 4 linhas de `replenishment_steps`; monta o estado puro do domínio. */
export async function loadReplenishment(data: FamilyData, id: string): Promise<LoadedReplenishment | null> {
  const row = await data.getOrNull("replenishments", id);
  if (!row) return null;
  const [stepRows, med] = await Promise.all([
    data.find("replenishment_steps", { replenishment_id: id }, { limit: 10 }),
    data.getOrNull("medications", s(row, "medication_id")),
  ]);
  const requiresPrescription = med ? med["requires_prescription"] !== false : true;
  const steps = STEPS.map<ReplenishmentStep>((step) => {
    const r = stepRows.find((x) => n(x, "step") === step);
    const done = sOpt(r ?? ({} as Row), "done_at") ?? null;
    return {
      step,
      owner_member_id: (r && sOpt(r, "owner_member_id")) || null,
      done_at: done,
      // Remédio sem exigência de receita: etapas 1–2 não se aplicam (não é gravado, é derivado).
      ...(!requiresPrescription && step <= 2 && !done ? { not_applicable: true } : {}),
      note: (r && sOpt(r, "note")) || null,
      prescription_id: (r && sOpt(r, "prescription_id")) || null,
      purchase_quantity: r && r["purchase_quantity"] !== null && r["purchase_quantity"] !== undefined ? n(r, "purchase_quantity") : null,
    };
  });
  return {
    row,
    patientId: s(row, "patient_id"),
    medicationId: s(row, "medication_id"),
    requiresPrescription,
    repl: {
      status: s(row, "status") as Replenishment["status"],
      triggered_by: s(row, "triggered_by") as Replenishment["triggered_by"],
      opened_at: s(row, "opened_at"),
      closed_at: sOpt(row, "closed_at") ?? null,
      steps,
    },
  };
}

/** Grava a diferença entre o estado carregado e o novo. Etapa já gravada por outro processo (409) é atualizada. */
export async function saveReplenishment(data: FamilyData, loaded: LoadedReplenishment, next: Replenishment): Promise<void> {
  const id = loaded.row.$id;
  const existing = await data.find("replenishment_steps", { replenishment_id: id }, { limit: 10 });
  for (const step of next.steps) {
    const before = loaded.repl.steps.find((x) => x.step === step.step)!;
    const changed =
      before.owner_member_id !== step.owner_member_id || before.done_at !== step.done_at || before.note !== step.note ||
      before.prescription_id !== step.prescription_id || before.purchase_quantity !== step.purchase_quantity;
    if (!changed) continue;
    const payload = {
      owner_member_id: step.owner_member_id ?? null,
      done_at: step.done_at ?? null,
      note: step.note ?? null,
      prescription_id: step.prescription_id ?? null,
      purchase_quantity: step.purchase_quantity ?? null,
    };
    const row = existing.find((x) => n(x, "step") === step.step);
    if (row) {
      await data.update("replenishment_steps", row.$id, payload);
      continue;
    }
    try {
      await data.create("replenishment_steps", { replenishment_id: id, step: step.step, ...payload });
    } catch (e) {
      if (!isConflict(e)) throw e;
      const [again] = await data.find("replenishment_steps", { replenishment_id: id, step: step.step }, { limit: 1 });
      if (again) await data.update("replenishment_steps", again.$id, payload);
    }
  }
  if (next.status !== loaded.repl.status || next.closed_at !== loaded.repl.closed_at) {
    await data.update("replenishments", id, { status: next.status, closed_at: next.closed_at ?? null });
  }
}

/**
 * Reposição aberta do par paciente+remédio, ou abre uma. Já abre em `prescription_received` quando há receita
 * vigente (docs/03). Sem índice único no modelo, duas chamadas simultâneas podem abrir duas; a segunda
 * chamada seguinte já encontra a primeira.
 */
export async function ensureOpenReplenishment(
  data: FamilyData,
  input: { patientId: string; medicationId: string; requiresPrescription: boolean; validPrescriptionId?: string | null; now: Date; triggeredBy?: Replenishment["triggered_by"] },
): Promise<string> {
  const open = await data.find(
    "replenishments",
    { patient_id: input.patientId, medication_id: input.medicationId, status: { in: ["needs_prescription", "prescription_received", "purchased"] } },
    { limit: 1, orderBy: "$createdAt" },
  );
  if (open[0]) return open[0].$id;

  const repl = openReplenishment({ triggeredBy: input.triggeredBy ?? "low_stock", requiresPrescription: input.requiresPrescription, now: input.now });
  const hasRx = input.requiresPrescription && !!input.validPrescriptionId;
  const row = await data.create("replenishments", {
    patient_id: input.patientId,
    medication_id: input.medicationId,
    status: hasRx ? "prescription_received" : "needs_prescription",
    triggered_by: repl.triggered_by,
    opened_at: repl.opened_at,
  });
  if (hasRx) {
    // Receita vigente já existe: as etapas 1 e 2 estão cumpridas (feitas pelo sistema, sem dono).
    for (const step of [1, 2] as const) {
      await data.create("replenishment_steps", { replenishment_id: row.$id, step, done_at: input.now.toISOString(), prescription_id: input.validPrescriptionId });
    }
  }
  return row.$id;
}
