import type { ReplenishmentStatus } from "./prescriptions";

/** Etapas (docs: Pedir receita → Receita recebida → Comprado → Estoque atualizado). */
export const REPLENISHMENT_STEPS = [1, 2, 3, 4] as const;
export type StepNumber = (typeof REPLENISHMENT_STEPS)[number];
export type StepState = "done" | "current" | "todo" | "not_applicable";

export interface ReplenishmentStep {
  step: StepNumber;
  owner_member_id: string | null;
  done_at: string | null;
  not_applicable?: boolean;
  note?: string | null;
  prescription_id?: string | null;
  purchase_quantity?: number | null;
}

export interface Replenishment {
  status: ReplenishmentStatus;
  triggered_by: "low_stock" | "prescription_expiry" | "manual";
  opened_at: string;
  closed_at: string | null;
  steps: ReplenishmentStep[];
}

export function openReplenishment(opts: {
  triggeredBy: Replenishment["triggered_by"];
  /** Remédio sem receita (otc): etapas 1 e 2 não se aplicam. */
  requiresPrescription: boolean;
  now: Date;
}): Replenishment {
  const steps = REPLENISHMENT_STEPS.map<ReplenishmentStep>((step) => ({
    step,
    owner_member_id: null,
    done_at: null,
    not_applicable: !opts.requiresPrescription && step <= 2 ? true : undefined,
  }));
  return withStatus({
    status: "needs_prescription",
    triggered_by: opts.triggeredBy,
    opened_at: opts.now.toISOString(),
    closed_at: null,
    steps,
  });
}

const resolved = (s: ReplenishmentStep) => s.done_at !== null || s.not_applicable === true;

/** Etapa atual = primeira não resolvida; null se encerrada. */
export function currentStep(r: Replenishment): ReplenishmentStep | null {
  if (r.status === "cancelled" || r.status === "done") return null;
  return r.steps.find((s) => !resolved(s)) ?? null;
}

export function stepState(r: Replenishment, step: StepNumber): StepState {
  const s = r.steps.find((x) => x.step === step)!;
  if (s.not_applicable) return "not_applicable";
  if (s.done_at) return "done";
  return currentStep(r)?.step === step ? "current" : "todo";
}

function withStatus(r: Replenishment): Replenishment {
  if (r.status === "cancelled") return r;
  const ok = (n: StepNumber) => resolved(r.steps.find((s) => s.step === n)!);
  let status: ReplenishmentStatus = "needs_prescription";
  if (ok(4) && ok(3)) status = "done";
  else if (ok(3) && ok(2)) status = "purchased";
  else if (ok(2)) status = "prescription_received";
  return { ...r, status };
}

export type AdvanceAction =
  | { type: "claim"; memberId: string; now: Date; takeOver?: boolean }
  | { type: "complete"; memberId: string; now: Date; note?: string; prescriptionId?: string; purchaseQuantity?: number }
  | { type: "cancel"; memberId: string; now: Date };

export type AdvanceResult =
  | { ok: true; replenishment: Replenishment; notify?: { kind: "claimed" | "completed" | "cancelled"; step?: StepNumber } }
  | { ok: false; reason: "closed" | "already_claimed" | "not_owner" | "missing_purchase_quantity" | "no_current_step" };

/**
 * Avança a reposição. `claim` = "Eu cuido disso" na etapa atual; recusa se outra pessoa já assumiu
 * (a menos que `takeOver`, o "Assumir no lugar"). `complete` só vale para quem assumiu ou se ninguém assumiu.
 */
export function advanceReplenishment(r: Replenishment, action: AdvanceAction): AdvanceResult {
  if (r.status === "done" || r.status === "cancelled") return { ok: false, reason: "closed" };

  if (action.type === "cancel") {
    return {
      ok: true,
      replenishment: { ...r, status: "cancelled", closed_at: action.now.toISOString() },
      notify: { kind: "cancelled" },
    };
  }

  const cur = currentStep(r);
  if (!cur) return { ok: false, reason: "no_current_step" };
  const patch = (p: Partial<ReplenishmentStep>): Replenishment => ({
    ...r,
    steps: r.steps.map((s) => (s.step === cur.step ? { ...s, ...p } : s)),
  });

  if (action.type === "claim") {
    if (cur.owner_member_id === action.memberId) return { ok: true, replenishment: r };
    if (cur.owner_member_id && !action.takeOver) return { ok: false, reason: "already_claimed" };
    return { ok: true, replenishment: patch({ owner_member_id: action.memberId }), notify: { kind: "claimed", step: cur.step } };
  }

  if (cur.owner_member_id && cur.owner_member_id !== action.memberId) return { ok: false, reason: "not_owner" };
  if (cur.step === 3 && (action.purchaseQuantity === undefined || action.purchaseQuantity <= 0)) {
    return { ok: false, reason: "missing_purchase_quantity" };
  }
  let next = patch({
    owner_member_id: cur.owner_member_id ?? action.memberId,
    done_at: action.now.toISOString(),
    note: action.note ?? cur.note ?? null,
    prescription_id: action.prescriptionId ?? cur.prescription_id ?? null,
    purchase_quantity: action.purchaseQuantity ?? cur.purchase_quantity ?? null,
  });
  next = withStatus(next);
  if (next.status === "done") next = { ...next, closed_at: action.now.toISOString() };
  return { ok: true, replenishment: next, notify: { kind: "completed", step: cur.step } };
}

/** Quantidade a somar ao estoque quando a reposição fecha (movimento `purchase`). */
export function purchaseQuantity(r: Replenishment): number {
  return r.steps.find((s) => s.step === 3)?.purchase_quantity ?? 0;
}
