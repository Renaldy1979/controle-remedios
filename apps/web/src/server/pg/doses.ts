import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte, or } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import {
  addDays, confirmDose as domainConfirm, generateDoseEvents, markLateAndMissed, undoDoseConfirmation, zonedToUtc,
  type ConfirmDoseRepo, type DoseEvent, type StockMovement, type TreatmentPhase, type UndoDoseRepo,
} from "@medcuidar/domain";
import type { DoseStatus, FamilySettings } from "@medcuidar/shared";
import type { DoseHistoryFilters, DoseHistoryResult } from "@/data/types";
import { localParts } from "@medcuidar/domain";
import { audit } from "./audit";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";
import { evaluateLowStock, refreshBalance } from "./stock";
import { toDomainPhase, toDomainTreatment } from "./mappers";
import { stampLabel } from "./stamp";

/** Quem age e as regras da família que importam para a dose (o `Ctx` do portal já serve). */
export type DoseActor = Actor & { settings: Pick<FamilySettings, "late_after_min" | "missed_after_min" | "repeat_reminder_options_min"> };

/** O "Desfazer" aparece por 8 s na tela (design.md); o servidor aceita até 30 s para absorver a latência de rede. */
export const UNDO_GRACE_MS = 30_000;

const iso = (d: Date) => d.toISOString();

type DoseRow = typeof s.doseEvents.$inferSelect;
type MovementRow = typeof s.stockMovements.$inferSelect;

const toDomainDose = (r: DoseRow): DoseEvent => ({
  id: r.id,
  family_id: r.familyId,
  treatment_id: r.treatmentId,
  patient_id: r.patientId,
  medication_id: r.medicationId,
  scheduled_at: iso(r.scheduledAt),
  status: r.status,
  confirmed_by_member_id: r.confirmedByMemberId,
  confirmed_at: r.confirmedAt ? iso(r.confirmedAt) : null,
  channel: r.channel,
  source_message_id: r.sourceMessageId,
  amount: r.amount,
  phase_id: r.phaseId,
});

const toDomainMovement = (m: MovementRow): StockMovement => ({
  id: m.id,
  family_id: m.familyId,
  stock_item_id: m.stockItemId,
  type: m.type,
  quantity: m.quantity,
  dose_event_id: m.doseEventId,
  replenishment_id: m.replenishmentId,
  created_by_member_id: m.createdByMemberId,
  note: m.note,
});

const fromDomainMovement = (m: StockMovement) => ({
  familyId: m.family_id,
  stockItemId: m.stock_item_id,
  type: m.type,
  quantity: m.quantity,
  doseEventId: m.dose_event_id ?? null,
  replenishmentId: m.replenishment_id ?? null,
  createdByMemberId: m.created_by_member_id ?? null,
  note: m.note ?? null,
});

/** Portas de persistência do domínio sobre a transação da família. A dose é lida com trava (`for update`): duas confirmações juntas se enfileiram. */
function repoFor(tx: Tx): ConfirmDoseRepo & UndoDoseRepo {
  return {
    async getDose(id) {
      const [r] = await tx.select().from(s.doseEvents).where(eq(s.doseEvents.id, id)).for("update");
      return r ? toDomainDose(r) : null;
    },
    async findDoseBySourceMessage(sourceMessageId) {
      const [r] = await tx.select().from(s.doseEvents).where(eq(s.doseEvents.sourceMessageId, sourceMessageId));
      return r ? toDomainDose(r) : null;
    },
    async findStockItemId(patientId, medicationId) {
      const [r] = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.patientId, patientId), eq(s.stockItems.medicationId, medicationId)));
      return r?.id ?? null;
    },
    async listDoseMovements(doseId) {
      const rows = await tx
        .select()
        .from(s.stockMovements)
        .where(or(eq(s.stockMovements.doseEventId, doseId), like(s.stockMovements.note, `undo:${doseId}:%`), like(s.stockMovements.note, `redo:${doseId}:%`)));
      return rows.map(toDomainMovement);
    },
    async insertMovement(m) {
      await tx.insert(s.stockMovements).values(fromDomainMovement(m));
    },
    async insertDoseMovementIfAbsent(m) {
      // índice único (dose_event_id): o desconto original existe uma só vez, mesmo com duas confirmações simultâneas
      const rows = await tx.insert(s.stockMovements).values(fromDomainMovement(m)).onConflictDoNothing().returning({ id: s.stockMovements.id });
      return rows.length > 0;
    },
    async markTaken(doseId, patch) {
      const [r] = await tx
        .update(s.doseEvents)
        .set({
          status: "taken",
          confirmedByMemberId: patch.confirmed_by_member_id,
          confirmedAt: new Date(patch.confirmed_at),
          channel: patch.channel,
          sourceMessageId: patch.source_message_id ?? null,
          remindAgainAt: null,
        })
        .where(eq(s.doseEvents.id, doseId))
        .returning();
      return toDomainDose(r!);
    },
    async resetDose(doseId, status) {
      const [r] = await tx
        .update(s.doseEvents)
        .set({ status, confirmedByMemberId: null, confirmedAt: null, channel: null, sourceMessageId: null })
        .where(eq(s.doseEvents.id, doseId))
        .returning();
      return toDomainDose(r!);
    },
  };
}

/* ------------------------------------------------------------------ geração das doses */

export interface EnsureResult {
  /** doses novas gravadas */
  created: number;
}

/**
 * Gera as doses de um dia local (`aaaa-mm-dd`) para todos os tratamentos ativos da família, a partir das fases.
 * Idempotente: o índice único (treatment_id, scheduled_at) descarta repetições (`ON CONFLICT DO NOTHING`), então pode
 * ser chamada a cada abertura do portal, por duas pessoas ao mesmo tempo, ou por um agendador/N8N nos próximos lotes.
 */
export async function ensureDosesForDay(familyId: string, date: string): Promise<EnsureResult> {
  return withFamilia(familyId, async (tx) => {
    const [fam] = await tx.select({ tz: s.families.timezone }).from(s.families).where(eq(s.families.id, familyId));
    if (!fam) return { created: 0 };
    const tz = fam.tz;
    const dayStart = zonedToUtc(date, 0, tz);
    const dayEnd = zonedToUtc(addDays(date, 1), 0, tz);

    const rows = await tx
      .select({ t: s.treatments })
      .from(s.treatments)
      .innerJoin(s.patients, eq(s.patients.id, s.treatments.patientId))
      .innerJoin(s.medications, eq(s.medications.id, s.treatments.medicationId))
      .where(and(eq(s.treatments.status, "active"), isNull(s.treatments.deletedAt), isNull(s.patients.deletedAt), isNull(s.medications.deletedAt), lte(s.treatments.startDate, date)));
    if (rows.length === 0) return { created: 0 };
    const ids = rows.map((r) => r.t.id);
    const phases = await tx.select().from(s.treatmentPhases).where(inArray(s.treatmentPhases.treatmentId, ids)).orderBy(asc(s.treatmentPhases.order));
    const existing = await tx
      .select({ treatmentId: s.doseEvents.treatmentId, scheduledAt: s.doseEvents.scheduledAt })
      .from(s.doseEvents)
      .where(and(inArray(s.doseEvents.treatmentId, ids), gte(s.doseEvents.scheduledAt, dayStart), lt(s.doseEvents.scheduledAt, dayEnd)));

    const values: Array<typeof s.doseEvents.$inferInsert> = [];
    for (const { t } of rows) {
      const treatment = toDomainTreatment(t);
      const domainPhases: TreatmentPhase[] = phases.filter((p) => p.treatmentId === t.id).map(toDomainPhase);
      const have = existing.filter((e) => e.treatmentId === t.id).map((e) => ({ scheduled_at: iso(e.scheduledAt) }));
      for (const d of generateDoseEvents(treatment, domainPhases, date, tz, have)) {
        values.push({
          familyId, treatmentId: d.treatment_id, patientId: d.patient_id, medicationId: d.medication_id,
          phaseId: d.phase_id, scheduledAt: new Date(d.scheduled_at), status: "pending", amount: d.amount,
        });
      }
    }
    if (values.length === 0) return { created: 0 };
    const inserted = await tx.insert(s.doseEvents).values(values).onConflictDoNothing({ target: [s.doseEvents.treatmentId, s.doseEvents.scheduledAt] }).returning({ id: s.doseEvents.id });
    return { created: inserted.length };
  });
}

/**
 * Persiste atraso (15 min) e esquecida (2 h) com as janelas da família, usando `markLateAndMissed` do domínio.
 * A tela também calcula o estado na leitura, então este passo só mantém o histórico e os relatórios em dia.
 */
export async function refreshDoseStatuses(familyId: string, settings: Pick<FamilySettings, "late_after_min" | "missed_after_min">, now: Date): Promise<number> {
  return withFamilia(familyId, async (tx) => {
    const open = await tx
      .select({ id: s.doseEvents.id, status: s.doseEvents.status, scheduledAt: s.doseEvents.scheduledAt })
      .from(s.doseEvents)
      .where(and(inArray(s.doseEvents.status, ["pending", "late"]), lte(s.doseEvents.scheduledAt, new Date(now.getTime() - settings.late_after_min * 60_000))));
    const changes = markLateAndMissed(now, settings, open.map((d) => ({ id: d.id, status: d.status as "pending" | "late", scheduled_at: iso(d.scheduledAt) })));
    for (const to of ["late", "missed"] as const) {
      const ids = changes.filter((c) => c.to === to).map((c) => c.doseId);
      if (ids.length) await tx.update(s.doseEvents).set({ status: to }).where(inArray(s.doseEvents.id, ids));
    }
    return changes.length;
  });
}

/** Estado exibido: o salvo, ajustado pelo relógio (atrasada/esquecida), sem esperar a rotina gravar. */
export function effectiveStatus(
  status: DoseStatus, scheduledAt: Date, now: Date, settings: Pick<FamilySettings, "late_after_min" | "missed_after_min">,
): DoseStatus {
  if (status !== "pending" && status !== "late") return status;
  const change = markLateAndMissed(now, settings, [{ id: "x", status, scheduled_at: iso(scheduledAt) }])[0];
  return change ? change.to : status;
}

/* ------------------------------------------------------------------ confirmar, desfazer, lembrar de novo */

/**
 * Confirma a dose. Idempotente: confirmar de novo não desconta de novo (índice único do movimento + trava da linha).
 * Serve também para "registrar que tomou depois" (dose atrasada ou esquecida). A baixa de estoque, o aviso de
 * estoque baixo e a auditoria acontecem na mesma transação.
 */
export async function confirmDose(actor: DoseActor, doseId: string, now: Date = new Date()): Promise<{ stockDeducted: boolean; duplicate: boolean }> {
  requirePermission(actor, "doses.confirm");
  return withFamilia(actor.familyId, async (tx) => {
    const res = await domainConfirm(repoFor(tx), { doseId, memberId: actor.memberId, channel: "panel", now });
    if (res.result === "not_found") throw new UserError("Dose não encontrada.");
    if (res.result === "not_confirmable") throw new UserError("Esta dose foi pulada e não pode ser confirmada.");
    if (res.result === "duplicate") return { stockDeducted: false, duplicate: true };
    await audit(tx, actor, "dose.confirm", "dose", doseId, { stock: res.stockDeducted });
    const [item] = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.patientId, res.dose.patient_id), eq(s.stockItems.medicationId, res.dose.medication_id)));
    if (item) {
      await refreshBalance(tx, item.id);
      await evaluateLowStock(tx, actor.familyId, item.id, now);
    }
    return { stockDeducted: res.stockDeducted, duplicate: false };
  });
}

/**
 * Desfaz a confirmação: só quem confirmou, nos primeiros 30 s (a tela oferece 8 s). O estoque volta com um movimento
 * de ajuste (`undo:<dose>:<n>`); o desconto original não é apagado (é único por dose).
 */
export async function undoDose(actor: DoseActor, doseId: string, now: Date = new Date()): Promise<{ stockRestored: boolean }> {
  requirePermission(actor, "doses.confirm");
  return withFamilia(actor.familyId, async (tx) => {
    const [cur] = await tx.select().from(s.doseEvents).where(eq(s.doseEvents.id, doseId)).for("update");
    if (!cur) throw new UserError("Dose não encontrada.");
    if (cur.status !== "taken") return { stockRestored: false }; // já desfeita (dois cliques): nada a fazer
    if (cur.confirmedByMemberId !== actor.memberId) throw new UserError("Só quem deu o check pode desfazer.");
    if (!cur.confirmedAt || now.getTime() - cur.confirmedAt.getTime() > UNDO_GRACE_MS) throw new UserError("O prazo para desfazer acabou.");
    const res = await undoDoseConfirmation(repoFor(tx), { doseId, memberId: actor.memberId, now, settings: actor.settings });
    if (res.result !== "undone") return { stockRestored: false };
    await audit(tx, actor, "dose.undo", "dose", doseId, { stock: res.stockRestored });
    const [item] = await tx.select({ id: s.stockItems.id }).from(s.stockItems).where(and(eq(s.stockItems.patientId, cur.patientId), eq(s.stockItems.medicationId, cur.medicationId)));
    if (item) await refreshBalance(tx, item.id);
    return { stockRestored: res.stockRestored };
  });
}

/** "Lembrar de novo": só registra o pedido (`remind_again_at`). O envio pelo WhatsApp é do Lote 4. */
export async function snoozeDose(actor: DoseActor, doseId: string, minutes: number, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "doses.confirm");
  if (!actor.settings.repeat_reminder_options_min.includes(minutes)) throw new UserError("Escolha 15, 30 ou 60 minutos.");
  await withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .update(s.doseEvents)
      .set({ remindAgainAt: new Date(now.getTime() + minutes * 60_000) })
      .where(and(eq(s.doseEvents.id, doseId), inArray(s.doseEvents.status, ["pending", "late", "missed"])))
      .returning({ id: s.doseEvents.id });
    if (!rows.length) throw new UserError("Esta dose não está esperando confirmação.");
    await audit(tx, actor, "dose.remind_again", "dose", doseId, { minutes });
  });
}

/* ------------------------------------------------------------------ histórico */

const HISTORY_LIMIT = 300;

/** Histórico de doses (passadas e de hoje) com filtros aplicados no banco. Exige `doses.history.view`. */
export async function listDoseHistory(actor: DoseActor, filters: DoseHistoryFilters, now: Date = new Date()): Promise<DoseHistoryResult> {
  requirePermission(actor, "doses.history.view");
  return withFamilia(actor.familyId, async (tx) => {
    const tz = actor.timezone;
    // já chegou a hora, ou foi tomada (inclusive adiantada)
    const conds = [or(lte(s.doseEvents.scheduledAt, now), eq(s.doseEvents.status, "taken"))!];
    if (filters.patientId) conds.push(eq(s.doseEvents.patientId, filters.patientId));
    if (filters.medicationId) conds.push(eq(s.doseEvents.medicationId, filters.medicationId));
    if (filters.memberId) conds.push(eq(s.doseEvents.confirmedByMemberId, filters.memberId));
    if (filters.from) conds.push(gte(s.doseEvents.scheduledAt, zonedToUtc(filters.from, 0, tz)));
    if (filters.to) conds.push(lt(s.doseEvents.scheduledAt, zonedToUtc(addDays(filters.to, 1), 0, tz)));
    // "late"/"missed" também valem para doses que o relógio já passou do prazo mas a rotina ainda não gravou
    if (filters.status === "taken" || filters.status === "skipped") conds.push(eq(s.doseEvents.status, filters.status));
    if (filters.status === "pending") conds.push(eq(s.doseEvents.status, "pending"));

    const rows = await tx
      .select({ d: s.doseEvents, med: s.medications.name, medUnit: s.medications.controlUnit, medRoute: s.medications.route, patient: s.patients.name, who: s.members.name })
      .from(s.doseEvents)
      .innerJoin(s.medications, eq(s.medications.id, s.doseEvents.medicationId))
      .innerJoin(s.patients, eq(s.patients.id, s.doseEvents.patientId))
      .leftJoin(s.members, eq(s.members.id, s.doseEvents.confirmedByMemberId))
      .where(and(...conds))
      .orderBy(desc(s.doseEvents.scheduledAt))
      .limit(HISTORY_LIMIT * 2 + 1);

    let list = rows.map((r) => ({ ...r, eff: effectiveStatus(r.d.status, r.d.scheduledAt, now, actor.settings) }));
    if (filters.status) list = list.filter((r) => r.eff === filters.status);
    const truncated = list.length > HISTORY_LIMIT;
    list = list.slice(0, HISTORY_LIMIT);

    const people = await tx
      .selectDistinct({ id: s.members.id, name: s.members.name })
      .from(s.doseEvents)
      .innerJoin(s.members, eq(s.members.id, s.doseEvents.confirmedByMemberId))
      .orderBy(asc(s.members.name));

    const p2 = (n: number) => String(n).padStart(2, "0");
    return {
      truncated,
      people,
      rows: list.map(({ d, med, patient, who, eff, medUnit, medRoute }) => {
        const at = localParts(d.scheduledAt, tz);
        const done = d.confirmedAt ? stampLabel(d.confirmedAt, tz).replace(/^(\d{2}\/\d{2})\/\d{4}/, "$1") : "";
        return {
          id: d.id,
          dateLabel: `${at.date.slice(8, 10)}/${at.date.slice(5, 7)}/${at.date.slice(0, 4)}`,
          time: `${p2(Math.floor(at.minutes / 60))}:${p2(at.minutes % 60)}`,
          medName: med,
          patientId: d.patientId,
          patientName: patient,
          status: eff,
          doseText: `${String(Math.round(d.amount * 100) / 100).replace(".", ",")} ${medUnit === "unit" ? (medRoute === "tablet" ? (d.amount === 1 ? "comprimido" : "comprimidos") : "un.") : medUnit === "drop" ? (d.amount === 1 ? "gota" : "gotas") : medUnit === "ml" ? "ml" : "g"}`,
          who: who ?? "",
          doneLabel: done,
          channel: d.channel === "whatsapp" ? "whatsapp" : d.channel ? "panel" : "",
        };
      }),
    };
  });
}
