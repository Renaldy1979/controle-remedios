import "server-only";
import { and, asc, desc, eq, isNull, like, not, or, sql } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { applyAdjustment } from "@medcuidar/domain";
import { can, familySettingsSchema, permissionMapSchema, type ControlUnit } from "@medcuidar/shared";
import { audit } from "./audit";
import { DEFAULT_LOW_STOCK_DAYS, computeStock, qtyText, weekdayLabel } from "./calc";
import { toDomainPhase, toDomainTreatment } from "./mappers";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";

const MAX_QTY = 100_000;

/** Soma do livro-razão (a verdade). `cached_balance` é só cache e é atualizado junto. */
export async function ledgerBalance(tx: Tx, stockItemId: string): Promise<number> {
  const [r] = await tx.select({ total: sql<number>`coalesce(sum(${s.stockMovements.quantity}), 0)::float8` }).from(s.stockMovements).where(eq(s.stockMovements.stockItemId, stockItemId));
  return Math.round((r?.total ?? 0) * 1000) / 1000;
}

export async function refreshBalance(tx: Tx, stockItemId: string): Promise<number> {
  const total = await ledgerBalance(tx, stockItemId);
  await tx.update(s.stockItems).set({ cachedBalance: total, cachedBalanceAt: new Date() }).where(eq(s.stockItems.id, stockItemId));
  return total;
}

/** O tratamento (vigente, não excluído) de um paciente para o remédio. */
async function treatmentOf(tx: Tx, patientId: string, medicationId: string) {
  const [t] = await tx.select().from(s.treatments).where(and(eq(s.treatments.patientId, patientId), eq(s.treatments.medicationId, medicationId), isNull(s.treatments.deletedAt)));
  return t;
}

/** Acha (ou cria) o item de estoque do remédio. Colírio (gotas) é sempre estimativa. */
export async function getOrCreateStockItem(tx: Tx, familyId: string, medicationId: string): Promise<{ id: string; patientId: string }> {
  const [med] = await tx.select().from(s.medications).where(and(eq(s.medications.id, medicationId), isNull(s.medications.deletedAt)));
  if (!med) throw new UserError("Remédio não encontrado.");
  const [t] = await tx.select().from(s.treatments).where(and(eq(s.treatments.medicationId, medicationId), isNull(s.treatments.deletedAt)));
  if (!t) throw new UserError("Este remédio ainda não tem paciente.");
  await tx
    .insert(s.stockItems)
    .values({ familyId, patientId: t.patientId, medicationId, controlUnit: med.controlUnit, isEstimate: med.controlUnit === "drop" })
    .onConflictDoNothing();
  const [item] = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.patientId, t.patientId), eq(s.stockItems.medicationId, medicationId)));
  return { id: item!.id, patientId: t.patientId };
}

async function familyDefaults(tx: Tx, familyId: string) {
  const [f] = await tx.select({ settings: s.families.settings, tz: s.families.timezone }).from(s.families).where(eq(s.families.id, familyId));
  return { settings: familySettingsSchema.parse(f?.settings ?? {}), tz: f?.tz ?? "America/Sao_Paulo" };
}

/* ------------------------------------------------------------------ compra, ajuste, previsão */

const cleanQty = (n: unknown, what: string): number => {
  if (typeof n !== "number" || !Number.isFinite(n)) throw new UserError(`Informe ${what}.`);
  return Math.round(n * 1000) / 1000;
};

/** Registra uma compra (entra no livro-razão como `purchase`). Cria o item de estoque se ainda não existe. */
export async function registerPurchase(actor: Actor, medicationId: string, quantity: number, note?: string, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "stock.adjust");
  const q = cleanQty(quantity, "a quantidade comprada");
  if (q <= 0 || q > MAX_QTY) throw new UserError("Informe uma quantidade maior que zero.");
  await withFamilia(actor.familyId, async (tx) => {
    const item = await getOrCreateStockItem(tx, actor.familyId, medicationId);
    // há reposição esperando a compra: esta compra é a etapa "Comprado" (soma ao estoque uma vez só e encerra a reposição)
    const { completePurchaseIfOpen } = await import("./replenishment");
    if (await completePurchaseIfOpen(tx, actor, item.patientId, medicationId, q, note?.trim() || undefined, now)) {
      await audit(tx, actor, "stock.purchase", "stock_item", item.id, { quantity: q });
      return;
    }
    await tx.insert(s.stockMovements).values({
      familyId: actor.familyId, stockItemId: item.id, type: "purchase", quantity: q, createdByMemberId: actor.memberId,
      note: note?.trim() ? `Compra: ${note.trim().slice(0, 120)}` : null,
    });
    await refreshBalance(tx, item.id);
    await audit(tx, actor, "stock.purchase", "stock_item", item.id, { quantity: q });
    await evaluateLowStock(tx, actor.familyId, item.id, now);
  });
}

/** Ajuste manual: o domínio calcula a diferença e ela vira um movimento `adjustment` (o saldo nunca é sobrescrito). */
export async function adjustStock(actor: Actor, medicationId: string, newBalance: number, reason: string, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "stock.adjust");
  const target = cleanQty(newBalance, "quanto tem agora");
  if (target < 0 || target > MAX_QTY) throw new UserError("Informe quanto tem agora (zero ou mais).");
  await withFamilia(actor.familyId, async (tx) => {
    const item = await getOrCreateStockItem(tx, actor.familyId, medicationId);
    const moves = await tx.select({ quantity: s.stockMovements.quantity }).from(s.stockMovements).where(eq(s.stockMovements.stockItemId, item.id));
    const move = applyAdjustment(moves, { familyId: actor.familyId, stockItemId: item.id, newBalance: target, memberId: actor.memberId, note: reason.trim() ? `Ajuste: ${reason.trim().slice(0, 120)}` : "Ajuste manual" });
    if (!move) throw new UserError("A quantidade é a mesma que já está registrada.");
    await tx.insert(s.stockMovements).values({
      familyId: actor.familyId, stockItemId: item.id, type: "adjustment", quantity: move.quantity, createdByMemberId: actor.memberId, note: move.note ?? null,
    });
    await refreshBalance(tx, item.id);
    // só o tamanho do ajuste vai para a auditoria (o motivo é texto livre e fica só no livro-razão)
    await audit(tx, actor, "stock.adjust", "stock_item", item.id, { delta: move.quantity });
    await evaluateLowStock(tx, actor.familyId, item.id, now);
  });
}

/** Quantos dias o estoque cobriria se entrassem (ou saíssem) `delta` unidades. Mostrado antes de confirmar uma compra. */
export async function previewStockDays(actor: Actor, medicationId: string, delta: number, now: Date = new Date()): Promise<number> {
  requirePermission(actor, "stock.view");
  const d = cleanQty(delta, "a quantidade");
  return withFamilia(actor.familyId, async (tx) => {
    const [med] = await tx.select().from(s.medications).where(and(eq(s.medications.id, medicationId), isNull(s.medications.deletedAt)));
    const [t] = await tx.select().from(s.treatments).where(and(eq(s.treatments.medicationId, medicationId), isNull(s.treatments.deletedAt)));
    if (!med || !t) return 0;
    const [item] = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.patientId, t.patientId), eq(s.stockItems.medicationId, medicationId)));
    const current = item ? await ledgerBalance(tx, item.id) : 0;
    const phases = (await tx.select().from(s.treatmentPhases).where(eq(s.treatmentPhases.treatmentId, t.id)).orderBy(asc(s.treatmentPhases.order))).map(toDomainPhase);
    const def = await familyDefaults(tx, actor.familyId);
    return computeStock({
      balance: current + d, isEstimate: med.controlUnit === "drop", controlUnit: med.controlUnit as ControlUnit, route: med.route, dropsPerMl: med.dropsPerMl,
      treatment: toDomainTreatment(t), phases, thresholdDays: t.lowStockDays ?? def.settings.default_low_stock_days, now, tz: def.tz,
    }).daysLeft;
  });
}

/* ------------------------------------------------------------------ aviso de estoque baixo */

/**
 * Início do ciclo atual do estoque: a última entrada que não é "desfazer dose" (compra ou ajuste manual positivo).
 * O aviso é único por ciclo: reconfirmar/desfazer a mesma dose não repete, e uma nova compra abre um ciclo novo.
 */
async function cycleOf(tx: Tx, stockItemId: string): Promise<string> {
  const [m] = await tx
    .select({ id: s.stockMovements.id })
    .from(s.stockMovements)
    .where(and(
      eq(s.stockMovements.stockItemId, stockItemId),
      sql`${s.stockMovements.quantity} > 0`,
      or(eq(s.stockMovements.type, "purchase"), and(eq(s.stockMovements.type, "adjustment"), not(like(s.stockMovements.note, "undo:%")), not(like(s.stockMovements.note, "redo:%")))),
    ))
    .orderBy(desc(s.stockMovements.createdAt), desc(s.stockMovements.id))
    .limit(1);
  return m?.id ?? "inicio";
}

/** Quem deve ser avisado: todo usuário ATIVO com permissão de comprar/ajustar estoque, de reposição, ou administrador. */
export async function stockAlertRecipients(tx: Tx): Promise<Array<{ id: string; name: string }>> {
  const rows = await tx
    .select({ id: s.members.id, name: s.members.name, profileName: s.profiles.name, permissions: s.profiles.permissions })
    .from(s.members)
    .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
    .where(and(eq(s.members.active, true), isNull(s.members.removedAt), eq(s.members.accessState, "active")));
  return rows
    .filter((r) => {
      const p = permissionMapSchema.safeParse(r.permissions);
      const m = { profileName: r.profileName, permissions: p.success ? p.data : {} };
      return can(m, "stock.adjust") || can(m, "replenishment.manage");
    })
    .map((r) => ({ id: r.id, name: r.name }));
}

/**
 * Se o estoque do item cruzou o limite (previsão ≤ limite em dias), cria o aviso do portal (sino) para quem pode comprar.
 * Idempotente: `dedupe_key` único (família + item + ciclo + pessoa). Devolve quantos avisos novos foram criados.
 */
export async function evaluateLowStock(tx: Tx, familyId: string, stockItemId: string, now: Date): Promise<number> {
  const [item] = await tx.select().from(s.stockItems).where(eq(s.stockItems.id, stockItemId));
  if (!item) return 0;
  const [med] = await tx.select().from(s.medications).where(and(eq(s.medications.id, item.medicationId), isNull(s.medications.deletedAt)));
  const t = await treatmentOf(tx, item.patientId, item.medicationId);
  if (!med || !t || t.status !== "active") return 0;
  const [patient] = await tx.select({ name: s.patients.name }).from(s.patients).where(and(eq(s.patients.id, item.patientId), isNull(s.patients.deletedAt)));
  if (!patient) return 0;

  const phases = (await tx.select().from(s.treatmentPhases).where(eq(s.treatmentPhases.treatmentId, t.id)).orderBy(asc(s.treatmentPhases.order))).map(toDomainPhase);
  const def = await familyDefaults(tx, familyId);
  const thresholdDays = t.lowStockDays ?? def.settings.default_low_stock_days ?? DEFAULT_LOW_STOCK_DAYS;
  const calc = computeStock({
    balance: await ledgerBalance(tx, stockItemId), isEstimate: item.isEstimate, controlUnit: item.controlUnit as ControlUnit, route: med.route, dropsPerMl: med.dropsPerMl,
    treatment: toDomainTreatment(t), phases, thresholdDays, now, tz: def.tz,
  });
  if (calc.status !== "critical") return 0;

  // cruzou o limite: abre a reposição (uma só por paciente e remédio; o índice do banco garante)
  const { openReplenishmentTx } = await import("./replenishment");
  await openReplenishmentTx(tx, familyId, { patientId: item.patientId, medicationId: med.id, requiresPrescription: med.requiresPrescription, trigger: "low_stock", now });

  const cycle = await cycleOf(tx, stockItemId);
  const recipients = await stockAlertRecipients(tx);
  if (recipients.length === 0) return 0;
  const first = patient.name.trim().split(/\s+/)[0] ?? patient.name;
  const when = calc.forecast.depletionDate ? ` O estoque acaba ${weekdayLabel(calc.forecast.depletionDate)}.` : "";
  const body = `Restam cerca de ${calc.daysLeft === 1 ? "1 dia" : `${calc.daysLeft} dias`} (${qtyText(calc.vm.quantity)} em estoque).${when}`;
  const rows = await tx
    .insert(s.notifications)
    .values(recipients.map((r) => ({
      familyId, memberId: r.id, kind: "low_stock" as const, title: `Estoque baixo: ${med.name} (${first})`, body,
      payload: { stockItemId, medicationId: med.id, patientId: item.patientId, daysLeft: calc.daysLeft, thresholdDays },
      dedupeKey: `low_stock:${stockItemId}:${cycle}:${r.id}`,
    })))
    .onConflictDoNothing({ target: [s.notifications.familyId, s.notifications.dedupeKey] })
    .returning({ id: s.notifications.id });
  return rows.length;
}

/** Confere todos os itens de estoque da família (ao abrir o portal, depois de mudar o limite ou o esquema). */
export async function evaluateLowStockForFamily(familyId: string, now: Date = new Date()): Promise<number> {
  return withFamilia(familyId, async (tx) => {
    const items = await tx.select({ id: s.stockItems.id }).from(s.stockItems);
    let n = 0;
    for (const i of items) n += await evaluateLowStock(tx, familyId, i.id, now);
    return n;
  });
}

/* ------------------------------------------------------------------ limites e janelas (Avisos) */

export interface NoticeSettingsPatch {
  /** limite padrão de estoque baixo, em dias */
  leadDays?: number;
  /** limite por remédio (substitui o padrão); `days: null` remove a exceção */
  exceptions?: Array<{ medicationId: string; days: number | null }>;
  lateAfterMin?: number;
  missedAfterMin?: number;
}

export async function saveNoticeSettings(actor: Actor, patch: NoticeSettingsPatch, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "settings.manage");
  const int = (n: number, min: number, max: number, what: string) => {
    if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${what} deve ser um número inteiro entre ${min} e ${max}.`);
    return n;
  };
  await withFamilia(actor.familyId, async (tx) => {
    const [f] = await tx.select({ settings: s.families.settings }).from(s.families).where(eq(s.families.id, actor.familyId));
    const cur = familySettingsSchema.parse(f?.settings ?? {});
    const next = { ...(f?.settings ?? {}) } as Record<string, unknown>;
    if (patch.leadDays !== undefined) next["default_low_stock_days"] = int(patch.leadDays, 1, 60, "A antecedência");
    const late = patch.lateAfterMin !== undefined ? int(patch.lateAfterMin, 1, 720, "O prazo de atraso") : cur.late_after_min;
    const missed = patch.missedAfterMin !== undefined ? int(patch.missedAfterMin, 1, 1440, "O prazo de esquecida") : cur.missed_after_min;
    if (missed <= late) throw new UserError("A dose só é esquecida depois de ficar atrasada: o prazo de esquecida precisa ser maior que o de atraso.");
    if (patch.lateAfterMin !== undefined) next["late_after_min"] = late;
    if (patch.missedAfterMin !== undefined) next["missed_after_min"] = missed;
    await tx.update(s.families).set({ settings: next }).where(eq(s.families.id, actor.familyId));

    for (const e of patch.exceptions ?? []) {
      const days = e.days === null ? null : int(e.days, 1, 60, "O limite do remédio");
      const rows = await tx.update(s.treatments).set({ lowStockDays: days }).where(and(eq(s.treatments.medicationId, e.medicationId), isNull(s.treatments.deletedAt))).returning({ id: s.treatments.id });
      if (!rows.length) throw new UserError("Remédio não encontrado.");
    }
    await audit(tx, actor, "notice_settings.save", "family", actor.familyId, {
      ...(patch.leadDays !== undefined ? { leadDays: patch.leadDays } : {}),
      ...(patch.exceptions ? { exceptions: patch.exceptions.length } : {}),
      ...(patch.lateAfterMin !== undefined ? { lateAfterMin: patch.lateAfterMin } : {}),
      ...(patch.missedAfterMin !== undefined ? { missedAfterMin: patch.missedAfterMin } : {}),
    });
    // um limite mais alto pode fazer o estoque atual já estar "baixo": avisa na hora
    const items = await tx.select({ id: s.stockItems.id }).from(s.stockItems);
    for (const i of items) await evaluateLowStock(tx, actor.familyId, i.id, now);
  });
}

