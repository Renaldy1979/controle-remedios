import "server-only";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { advanceReplenishment, currentStep, openReplenishment, type AdvanceResult, type Replenishment, type StepNumber } from "@medcuidar/domain";
import { audit } from "./audit";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";
import { membersWithPermission } from "./recipients";
import { qtyText } from "./calc";
import { getOrCreateStockItem, refreshBalance } from "./stock";

/** Textos das 4 etapas (docs/06): usados no portal, nos avisos e no registro de ações. */
export const STEP_LABELS = ["Pedir receita ao médico", "Receita recebida", "Comprado", "Estoque atualizado"] as const;
export const STEP_VERBS = ["vai pedir a receita", "vai buscar a receita", "vai comprar", "vai atualizar o estoque"] as const;

const MAX_QTY = 100_000;
const OPEN = ["done", "cancelled"] as const;
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

type StepRow = typeof s.replenishmentSteps.$inferSelect;
type ReplRow = typeof s.replenishments.$inferSelect;

export interface LoadedRepl {
  row: ReplRow;
  steps: StepRow[];
  repl: Replenishment;
}

/** Linhas do Postgres → objeto do domínio (a lógica das etapas mora em `@medcuidar/domain`). */
export function toDomainRepl(row: ReplRow, steps: StepRow[]): Replenishment {
  return {
    status: row.status,
    triggered_by: row.triggeredBy,
    opened_at: row.openedAt.toISOString(),
    closed_at: row.closedAt?.toISOString() ?? null,
    steps: [...steps]
      .sort((a, b) => a.step - b.step)
      .map((st) => ({
        step: st.step as StepNumber,
        owner_member_id: st.ownerMemberId,
        done_at: st.doneAt?.toISOString() ?? null,
        ...(st.notApplicable ? { not_applicable: true } : {}),
        note: st.note,
        prescription_id: st.prescriptionId,
        purchase_quantity: st.purchaseQuantity,
      })),
  };
}

async function loadRepl(tx: Tx, id: string, lock = false): Promise<LoadedRepl | null> {
  const q = tx.select().from(s.replenishments).where(eq(s.replenishments.id, id));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) return null;
  const steps = await tx.select().from(s.replenishmentSteps).where(eq(s.replenishmentSteps.replenishmentId, id)).orderBy(asc(s.replenishmentSteps.step));
  return { row, steps, repl: toDomainRepl(row, steps) };
}

/** Grava o que mudou entre o carregado e o novo estado do domínio (status, etapas, quem assumiu e quando). */
async function saveRepl(tx: Tx, loaded: LoadedRepl, next: Replenishment, now: Date): Promise<void> {
  await tx
    .update(s.replenishments)
    .set({ status: next.status, closedAt: next.closed_at ? new Date(next.closed_at) : null })
    .where(eq(s.replenishments.id, loaded.row.id));
  for (const st of next.steps) {
    const old = loaded.steps.find((x) => x.step === st.step)!;
    const doneAt = st.done_at ? new Date(st.done_at) : null;
    const changed =
      old.ownerMemberId !== st.owner_member_id || (old.doneAt?.getTime() ?? null) !== (doneAt?.getTime() ?? null) ||
      old.note !== (st.note ?? null) || old.prescriptionId !== (st.prescription_id ?? null) || old.purchaseQuantity !== (st.purchase_quantity ?? null);
    if (!changed) continue;
    await tx
      .update(s.replenishmentSteps)
      .set({
        ownerMemberId: st.owner_member_id, doneAt, note: st.note ?? null, prescriptionId: st.prescription_id ?? null, purchaseQuantity: st.purchase_quantity ?? null,
        ...(old.ownerMemberId !== st.owner_member_id ? { claimedAt: st.owner_member_id ? now : null } : {}),
      })
      .where(eq(s.replenishmentSteps.id, old.id));
  }
}

/** A reposição aberta (não concluída nem cancelada) do paciente para o remédio, se houver. */
export async function findOpenRepl(tx: Tx, patientId: string, medicationId: string, lock = false): Promise<LoadedRepl | null> {
  const q = tx
    .select({ id: s.replenishments.id })
    .from(s.replenishments)
    .where(and(eq(s.replenishments.patientId, patientId), eq(s.replenishments.medicationId, medicationId), notInArray(s.replenishments.status, [...OPEN])));
  const [r] = await q;
  return r ? loadRepl(tx, r.id, lock) : null;
}

/** Remédio vivo, com o paciente do tratamento (um tratamento por remédio e paciente). */
async function subjectOf(tx: Tx, medicationId: string) {
  const [r] = await tx
    .select({ med: s.medications, patientId: s.treatments.patientId, patientName: s.patients.name })
    .from(s.medications)
    .innerJoin(s.treatments, and(eq(s.treatments.medicationId, s.medications.id), isNull(s.treatments.deletedAt)))
    .innerJoin(s.patients, and(eq(s.patients.id, s.treatments.patientId), isNull(s.patients.deletedAt)))
    .where(and(eq(s.medications.id, medicationId), isNull(s.medications.deletedAt)));
  if (!r) throw new UserError("Remédio não encontrado.");
  return r;
}

/* ------------------------------------------------------------------ avisos da reposição */

async function notifyOthers(
  tx: Tx, familyId: string, actorId: string,
  n: { replId: string; key: string; title: string; body: string; medicationId: string; patientId: string },
): Promise<void> {
  const to = (await membersWithPermission(tx, "replenishment.manage")).filter((m) => m.id !== actorId);
  if (to.length === 0) return;
  await tx
    .insert(s.notifications)
    .values(to.map((m) => ({
      familyId, memberId: m.id, kind: "replenishment_update" as const, title: n.title, body: n.body,
      payload: { replenishmentId: n.replId, medicationId: n.medicationId, patientId: n.patientId }, dedupeKey: `repl:${n.replId}:${n.key}:${m.id}`,
    })))
    .onConflictDoNothing({ target: [s.notifications.familyId, s.notifications.dedupeKey] });
}

/* ------------------------------------------------------------------ abrir */

/**
 * Abre a reposição (idempotente: no máximo UMA aberta por paciente e remédio, garantido pelo índice parcial do banco).
 * Remédio sem receita (`requires_prescription = false`) já nasce com as etapas 1 e 2 como "não se aplica".
 * Devolve o id da reposição criada, ou null se já havia uma aberta.
 */
export async function openReplenishmentTx(
  tx: Tx, familyId: string, o: { patientId: string; medicationId: string; requiresPrescription: boolean; trigger: "low_stock" | "prescription_expiry" | "manual"; now: Date },
): Promise<string | null> {
  const domain = openReplenishment({ triggeredBy: o.trigger, requiresPrescription: o.requiresPrescription, now: o.now });
  const [created] = await tx
    .insert(s.replenishments)
    .values({ familyId, patientId: o.patientId, medicationId: o.medicationId, triggeredBy: o.trigger, openedAt: o.now })
    .onConflictDoNothing()
    .returning({ id: s.replenishments.id });
  if (!created) return null;
  await tx.insert(s.replenishmentSteps).values(domain.steps.map((st) => ({ familyId, replenishmentId: created.id, step: st.step, notApplicable: st.not_applicable === true })));
  return created.id;
}

/** "Iniciar reposição" na mão (o portal também abre sozinho quando o estoque cruza o limite). */
export async function openManually(actor: Actor, medicationId: string, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "replenishment.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const sub = await subjectOf(tx, medicationId);
    const id = await openReplenishmentTx(tx, actor.familyId, { patientId: sub.patientId, medicationId, requiresPrescription: sub.med.requiresPrescription, trigger: "manual", now });
    if (id) await audit(tx, actor, "replenishment.opened", "replenishment", id, { patientId: sub.patientId, medicationIds: [medicationId], trigger: "manual" });
  });
}

/* ------------------------------------------------------------------ assumir, concluir, cancelar */

const claimMessage = (r: Extract<AdvanceResult, { ok: false }>["reason"], ownerName: string): string =>
  r === "already_claimed" ? `${ownerName || "Outra pessoa"} já assumiu esta etapa. Use “Assumir no lugar” se for combinar com ${ownerName ? "essa pessoa" : "ela"}.`
  : r === "closed" ? "Esta reposição já foi encerrada."
  : "Não foi possível assumir esta etapa.";

/** "Eu cuido disso" / "Assumir no lugar". Abre a reposição se ainda não houver. Duas pessoas nunca ficam na mesma etapa. */
export async function claim(actor: Actor, medicationId: string, opts: { takeOver?: boolean } = {}, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "replenishment.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const sub = await subjectOf(tx, medicationId);
    let loaded = await findOpenRepl(tx, sub.patientId, medicationId, true);
    if (!loaded) {
      const id = await openReplenishmentTx(tx, actor.familyId, { patientId: sub.patientId, medicationId, requiresPrescription: sub.med.requiresPrescription, trigger: "manual", now });
      loaded = id ? await loadRepl(tx, id, true) : await findOpenRepl(tx, sub.patientId, medicationId, true);
    }
    if (!loaded) throw new UserError("Não foi possível abrir a reposição.");
    const cur = currentStep(loaded.repl);
    const res = advanceReplenishment(loaded.repl, { type: "claim", memberId: actor.memberId, now, ...(opts.takeOver ? { takeOver: true } : {}) });
    if (!res.ok) {
      let ownerName = "";
      if (cur?.owner_member_id) {
        const [o] = await tx.select({ name: s.members.name }).from(s.members).where(eq(s.members.id, cur.owner_member_id));
        ownerName = o ? firstName(o.name) : "";
      }
      throw new UserError(claimMessage(res.reason, ownerName));
    }
    if (res.replenishment === loaded.repl) return; // já era dela/dele: nada a fazer (idempotente)
    await saveRepl(tx, loaded, res.replenishment, now);
    const step = cur!.step;
    await audit(tx, actor, "replenishment.claimed", "replenishment", loaded.row.id, { patientId: sub.patientId, medicationIds: [medicationId], step });
    await notifyOthers(tx, actor.familyId, actor.memberId, {
      replId: loaded.row.id, key: `claim:${step}:${now.getTime()}`, medicationId, patientId: sub.patientId,
      title: `${firstName(actor.member.name)} ${STEP_VERBS[step - 1]}: ${sub.med.name} (${firstName(sub.patientName)})`,
      body: `Etapa ${step} de 4 · ${STEP_LABELS[step - 1]}.`,
    });
  });
}

export interface AdvanceOpts {
  /** etapa "Comprado": quantas unidades entraram */
  quantity?: number;
  note?: string;
}

/**
 * Conclui a etapa atual ("Marcar como feito"). Na etapa "Comprado" a compra é registrada no livro-razão
 * (movimento `purchase` ligado à reposição, uma única vez), a etapa "Estoque atualizado" fecha junto e a reposição se encerra.
 */
export async function completeStep(actor: Actor, medicationId: string, opts: AdvanceOpts = {}, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "replenishment.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const sub = await subjectOf(tx, medicationId);
    const loaded = await findOpenRepl(tx, sub.patientId, medicationId, true);
    if (!loaded) throw new UserError("Não há reposição aberta para este remédio.");
    await completeIn(tx, actor, loaded, { patientId: sub.patientId, medName: sub.med.name, patientName: sub.patientName, requiresPrescription: sub.med.requiresPrescription }, opts, now, false);
  });
}

interface Subject {
  patientId: string;
  medName: string;
  patientName: string;
  requiresPrescription: boolean;
}

async function completeIn(tx: Tx, actor: Actor, loaded: LoadedRepl, sub: Subject, opts: AdvanceOpts, now: Date, takeOver: boolean): Promise<void> {
  const medicationId = loaded.row.medicationId;
  const cur = currentStep(loaded.repl);
  if (!cur) throw new UserError("Esta reposição já foi encerrada.");

  let working = loaded.repl;
  if (takeOver && cur.owner_member_id && cur.owner_member_id !== actor.memberId) {
    const c = advanceReplenishment(working, { type: "claim", memberId: actor.memberId, now, takeOver: true });
    if (c.ok) working = c.replenishment;
  }

  let prescriptionId: string | undefined;
  if (cur.step === 2) {
    // "receita recebida": precisa existir uma receita vigente do paciente com este remédio (anexar a receita já avança a etapa sozinho)
    const [rx] = await tx
      .select({ id: s.prescriptions.id })
      .from(s.prescriptions)
      .innerJoin(s.prescriptionItems, eq(s.prescriptionItems.prescriptionId, s.prescriptions.id))
      .where(and(eq(s.prescriptions.patientId, sub.patientId), eq(s.prescriptionItems.medicationId, medicationId), isNull(s.prescriptions.deletedAt), eq(s.prescriptions.status, "valid"), sql`(${s.prescriptions.validUntil} is null or ${s.prescriptions.validUntil} >= ${now.toISOString().slice(0, 10)})`))
      .limit(1);
    if (!rx) throw new UserError("Anexe a receita recebida para concluir esta etapa.");
    prescriptionId = rx.id;
  }

  let qty: number | undefined;
  if (cur.step === 3) {
    qty = typeof opts.quantity === "number" && Number.isFinite(opts.quantity) ? Math.round(opts.quantity * 1000) / 1000 : undefined;
    if (!qty || qty <= 0 || qty > MAX_QTY) throw new UserError("Informe a quantidade comprada.");
  }

  const step = advanceReplenishment(working, {
    type: "complete", memberId: actor.memberId, now, ...(opts.note ? { note: opts.note.slice(0, 120) } : {}), ...(prescriptionId ? { prescriptionId } : {}), ...(qty ? { purchaseQuantity: qty } : {}),
  });
  if (!step.ok) {
    throw new UserError(
      step.reason === "not_owner" ? "Outra pessoa assumiu esta etapa. Use “Assumir no lugar” se for combinar com ela."
      : step.reason === "missing_purchase_quantity" ? "Informe a quantidade comprada."
      : step.reason === "closed" ? "Esta reposição já foi encerrada."
      : "Não foi possível concluir a etapa.",
    );
  }
  let next = step.replenishment;
  const label = `${sub.medName} (${firstName(sub.patientName)})`;

  if (cur.step === 3 && qty) {
    // a compra entra no estoque UMA vez (índice único por reposição) e a etapa 4 fecha junto
    const item = await getOrCreateStockItem(tx, actor.familyId, medicationId);
    await tx.insert(s.stockMovements).values({
      familyId: actor.familyId, stockItemId: item.id, type: "purchase", quantity: qty, replenishmentId: loaded.row.id, createdByMemberId: actor.memberId, note: "Compra: reposição",
    });
    await refreshBalance(tx, item.id);
    const last = advanceReplenishment(next, { type: "complete", memberId: actor.memberId, now, note: "Estoque atualizado" });
    if (last.ok) next = last.replenishment;
  }

  await saveRepl(tx, loaded, next, now);
  const done = next.status === "done";
  await audit(tx, actor, done ? "replenishment.done" : "replenishment.step_done", "replenishment", loaded.row.id, { patientId: sub.patientId, medicationIds: [medicationId], step: cur.step, ...(qty ? { quantity: qty } : {}) });
  await notifyOthers(tx, actor.familyId, actor.memberId, {
    replId: loaded.row.id, key: done ? "done" : `step:${cur.step}`, medicationId, patientId: sub.patientId,
    title: done ? `Reposição concluída: ${label}` : `Etapa concluída: ${STEP_LABELS[cur.step - 1]} · ${label}`,
    body: done ? `Entraram ${qtyText(qty ?? 0)} no estoque.` : `Etapa ${cur.step} de 4 concluída por ${firstName(actor.member.name)}.`,
  });
  if (done) {
    const { evaluateLowStock } = await import("./stock");
    const item = await getOrCreateStockItem(tx, actor.familyId, medicationId);
    await evaluateLowStock(tx, actor.familyId, item.id, now);
  }
}

/**
 * Registrar compra pelo Estoque (Lote 2) quando há reposição aberta esperando a compra: a compra vira a etapa "Comprado"
 * (e fecha a reposição) em vez de um movimento solto. Devolve false se não há reposição nessa etapa (compra comum).
 */
export async function completePurchaseIfOpen(tx: Tx, actor: Actor, patientId: string, medicationId: string, quantity: number, note: string | undefined, now: Date): Promise<boolean> {
  const loaded = await findOpenRepl(tx, patientId, medicationId, true);
  if (!loaded) return false;
  const cur = currentStep(loaded.repl);
  if (cur?.step !== 3) return false;
  const sub = await subjectOf(tx, medicationId);
  await completeIn(tx, actor, loaded, { patientId, medName: sub.med.name, patientName: sub.patientName, requiresPrescription: sub.med.requiresPrescription }, { quantity, ...(note ? { note } : {}) }, now, true);
  return true;
}

export async function cancel(actor: Actor, medicationId: string, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "replenishment.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const sub = await subjectOf(tx, medicationId);
    const loaded = await findOpenRepl(tx, sub.patientId, medicationId, true);
    if (!loaded) throw new UserError("Não há reposição aberta para este remédio.");
    const res = advanceReplenishment(loaded.repl, { type: "cancel", memberId: actor.memberId, now });
    if (!res.ok) throw new UserError("Esta reposição já foi encerrada.");
    await saveRepl(tx, loaded, res.replenishment, now);
    await audit(tx, actor, "replenishment.cancelled", "replenishment", loaded.row.id, { patientId: sub.patientId, medicationIds: [medicationId] });
    await notifyOthers(tx, actor.familyId, actor.memberId, {
      replId: loaded.row.id, key: "cancelled", medicationId, patientId: sub.patientId,
      title: `Reposição cancelada: ${sub.med.name} (${firstName(sub.patientName)})`, body: `${firstName(actor.member.name)} encerrou a reposição.`,
    });
  });
}

/* ------------------------------------------------------------------ receita recebida */

/**
 * Anexou uma receita nova: as reposições abertas (do mesmo paciente) desses remédios que esperam a receita avançam para
 * "receita recebida" (etapas 1 e 2 resolvidas, a 2 ligada à receita). Devolve os ids avançados.
 */
export async function onPrescriptionReceived(
  tx: Tx, actor: Actor, o: { patientId: string; medicationIds: string[]; prescriptionId: string; now: Date },
): Promise<string[]> {
  if (o.medicationIds.length === 0) return [];
  const rows = await tx
    .select({ id: s.replenishments.id, medicationId: s.replenishments.medicationId })
    .from(s.replenishments)
    .where(and(eq(s.replenishments.patientId, o.patientId), inArray(s.replenishments.medicationId, o.medicationIds), eq(s.replenishments.status, "needs_prescription")));
  const advanced: string[] = [];
  for (const r of rows) {
    const loaded = await loadRepl(tx, r.id, true);
    if (!loaded || loaded.repl.status !== "needs_prescription") continue;
    const steps = loaded.repl.steps.map((st) => {
      if (st.step > 2 || st.not_applicable || st.done_at) return st;
      return { ...st, owner_member_id: st.owner_member_id ?? actor.memberId, done_at: o.now.toISOString(), ...(st.step === 2 ? { prescription_id: o.prescriptionId } : {}) };
    });
    await saveRepl(tx, loaded, { ...loaded.repl, status: "prescription_received", steps }, o.now);
    advanced.push(r.id);
    const [med] = await tx.select({ name: s.medications.name }).from(s.medications).where(eq(s.medications.id, r.medicationId));
    const [pat] = await tx.select({ name: s.patients.name }).from(s.patients).where(eq(s.patients.id, o.patientId));
    await audit(tx, actor, "replenishment.step_done", "replenishment", r.id, { patientId: o.patientId, medicationIds: [r.medicationId], step: 2 });
    await notifyOthers(tx, actor.familyId, actor.memberId, {
      replId: r.id, key: "step:2", medicationId: r.medicationId, patientId: o.patientId,
      title: `Receita recebida: ${med?.name ?? "remédio"} (${firstName(pat?.name ?? "")})`, body: "A receita foi anexada. Falta comprar.",
    });
  }
  return advanced;
}
