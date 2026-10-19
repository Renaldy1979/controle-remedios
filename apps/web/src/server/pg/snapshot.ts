import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { addDays, effectiveRecipientsMode, localParts, resolveResponsible, zonedToUtc } from "@medcuidar/domain";
import { PERMISSION_GROUPS, SYSTEM_PROFILES, can, permissionMapSchema, type ControlUnit, type PermissionMap } from "@medcuidar/shared";
import type {
  AccessState, DoseVM, MedicationVM, PatientVM, PermissionRowVM, PersonVM, ReplenishmentVM, Role, Snapshot, StockMovementVM, StockVM, Tone,
} from "@/data/types";
import { ROUTE_LABEL, UNIT_LABEL } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { intervalTimes } from "@/lib/times";
import type { Ctx } from "./access";
import { DEFAULT_LOW_STOCK_DAYS, UNTRACKED_STOCK, computeStock, doseWhenLabel, qtyText, unitNoun } from "./calc";
import { effectiveStatus } from "./doses";
import { toDomainPhase, toDomainTreatment } from "./mappers";
import { listNotices } from "./notices";
import { stampLabel } from "./stamp";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
const p2 = (n: number) => String(n).padStart(2, "0");
const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const weekdayLabel = (ymd: string) => `${WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}, ${ddmm(ymd)}`;
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Idade em anos completos na data local de hoje. */
export function ageOn(birth: string, today: string): number {
  let age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  if (today.slice(5) < birth.slice(5)) age -= 1;
  return Math.max(0, age);
}

const roleOfProfile = (name: string): Role =>
  name === "Administrador" ? "admin" : name === "Familiar" ? "family" : name === "Cuidadora" ? "caregiver" : name === "Confirmador" ? "confirmer" : "other";

/** Quem não pode ver estoque recebe um modelo vazio (a tela também esconde o bloco). */
const HIDDEN_STOCK: StockVM = { quantity: 0, quantityText: "", approximate: false, daysLeft: 0, level: "ok", runsOutLabel: "", barPct: 0, tracked: false };
const NO_REPL: ReplenishmentVM = {
  step: 0, done: false, steps: [], stepText: "", ownerText: "", ownerTone: "neu", canAssume: false, assumeLabel: "", advanceLabel: "",
  needsAttach: false, needsQuantity: false, log: [], mine: false,
};

/** Retrato que as telas consomem, montado do Postgres dentro de withFamilia. Já vem sem o que o perfil não pode ver. */
export async function buildSnapshot(ctx: Ctx, now: Date = new Date()): Promise<Snapshot> {
  const { date: today, minutes } = localParts(now, ctx.timezone);
  const canDo = (k: Parameters<typeof can>[1]) => can(ctx.member, k);

  const L = await withFamilia(ctx.familyId, async (tx) => {
    const members = await tx.select().from(s.members).orderBy(asc(s.members.createdAt));
    const profiles = await tx.select().from(s.profiles);
    const patients = await tx.select().from(s.patients).where(isNull(s.patients.deletedAt)).orderBy(asc(s.patients.createdAt));
    const medications = await tx.select().from(s.medications).where(isNull(s.medications.deletedAt)).orderBy(asc(s.medications.createdAt));
    const treatments = await tx.select().from(s.treatments).where(and(isNull(s.treatments.deletedAt)));
    const phases = treatments.length
      ? await tx.select().from(s.treatmentPhases).where(inArray(s.treatmentPhases.treatmentId, treatments.map((t) => t.id))).orderBy(asc(s.treatmentPhases.order))
      : [];
    const invites = await tx.select().from(s.invites).where(and(isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));

    // Lote 2: doses de hoje (e as de ontem que ainda esperam resolução), estoque e livro-razão
    const dayStart = zonedToUtc(today, 0, ctx.timezone);
    const dayEnd = zonedToUtc(addDays(today, 1), 0, ctx.timezone);
    const seeDoses = canDo("dashboard.view") || canDo("patients.view");
    const doses = !seeDoses
      ? []
      : await tx.select().from(s.doseEvents).where(or(
          and(gte(s.doseEvents.scheduledAt, dayStart), lt(s.doseEvents.scheduledAt, dayEnd)),
          and(gte(s.doseEvents.scheduledAt, new Date(dayStart.getTime() - 24 * 3600_000)), lt(s.doseEvents.scheduledAt, dayStart), inArray(s.doseEvents.status, ["pending", "late", "missed"])),
        )).orderBy(asc(s.doseEvents.scheduledAt));
    const recentTakenRows = !seeDoses ? [] : await tx.select().from(s.doseEvents).where(eq(s.doseEvents.status, "taken")).orderBy(desc(s.doseEvents.confirmedAt)).limit(5);
    const seeStock = canDo("stock.view");
    const stockItems = seeStock ? await tx.select().from(s.stockItems) : [];
    const sums = seeStock
      ? await tx.select({ id: s.stockMovements.stockItemId, total: sql<number>`coalesce(sum(${s.stockMovements.quantity}), 0)::float8` }).from(s.stockMovements).groupBy(s.stockMovements.stockItemId)
      : [];
    const movements = seeStock ? await tx.select().from(s.stockMovements).orderBy(desc(s.stockMovements.createdAt), desc(s.stockMovements.id)).limit(40) : [];
    const assignments = seeDoses ? await tx.select().from(s.careAssignments) : [];
    return { members, profiles, patients, medications, treatments, phases, invites, doses, recentTakenRows, stockItems, sums, movements, assignments };
  });

  const profileById = new Map(L.profiles.map((p) => [p.id, p]));
  const memberById = new Map(L.members.map((m) => [m.id, m]));
  const permsOf = (p: { permissions: unknown } | undefined): PermissionMap => {
    const r = permissionMapSchema.safeParse(p?.permissions ?? {});
    return r.success ? r.data : {};
  };

  const canSeePeople = canDo("members.manage") || canDo("patients.manage");
  const order = SYSTEM_PROFILES.map((p) => p.name);
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : 99);
  const profileNames = L.profiles.map((p) => p.name).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "pt-BR"));

  const inviteOf = (memberId: string) => L.invites.find((i) => i.memberId === memberId);
  const people: PersonVM[] = canSeePeople
    ? L.members
        .filter((m) => !(m.removedAt && m.accessState === "invited"))
        .sort((a, b) => Number(b.active) - Number(a.active) || a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => {
          const prof = profileById.get(m.profileId);
          const inv = inviteOf(m.id);
          return {
            id: m.id,
            name: m.name,
            relation: m.roleLabel ?? "",
            profileName: prof?.name ?? "",
            role: roleOfProfile(prof?.name ?? ""),
            phone: m.phoneVerified ? formatPhone(m.phoneVerified) : "",
            whatsappActive: !!m.phoneVerified,
            receivesAlerts: m.receivesFamilyAlerts,
            permissions: permsOf(prof),
            accessState: m.accessState as AccessState,
            email: m.email ?? "",
            phonePending: m.phonePending ?? "",
            active: m.active,
            isSelf: m.id === ctx.memberId,
            ...(inv ? { invite: { kind: inv.kind, expiresLabel: stampLabel(inv.expiresAt, ctx.timezone), expired: inv.expiresAt < now } } : {}),
          };
        })
    : [];

  const patients: PatientVM[] = L.patients
    .filter(() => canDo("patients.view") || canDo("patients.manage"))
    .map((p) => {
      const self = p.selfMemberId ? memberById.get(p.selfMemberId) : undefined;
      return {
        id: p.id,
        name: firstName(p.name),
        fullName: p.name,
        age: p.birthDate ? ageOn(p.birthDate, today) : 0,
        note: p.notes ?? "",
        usesPhone: p.canUsePhone,
        phone: p.canUsePhone ? (self?.phoneVerified && canSeePeople ? formatPhone(self.phoneVerified) : "") : "Sem celular",
        birthDate: p.birthDate ?? "",
        selfMemberId: p.selfMemberId ?? null,
        selfMemberName: self?.name ?? "",
      };
    });
  const patientIds = new Set(L.patients.map((p) => p.id));

  const defaultLow = ctx.settings.default_low_stock_days ?? DEFAULT_LOW_STOCK_DAYS;
  const sumById = new Map(L.sums.map((x) => [x.id, x.total]));
  const stockVmFor = (med: (typeof L.medications)[number], t: (typeof L.treatments)[number], phases: (typeof L.phases)): StockVM => {
    if (!canDo("stock.view")) return HIDDEN_STOCK;
    const item = L.stockItems.find((i) => i.patientId === t.patientId && i.medicationId === med.id);
    if (!item) return UNTRACKED_STOCK;
    return computeStock({
      balance: sumById.get(item.id) ?? 0, isEstimate: item.isEstimate, controlUnit: item.controlUnit as ControlUnit, route: med.route, dropsPerMl: med.dropsPerMl,
      treatment: toDomainTreatment(t), phases: phases.map(toDomainPhase), thresholdDays: t.lowStockDays ?? defaultLow, now, tz: ctx.timezone,
    }).vm;
  };

  const medsVM: MedicationVM[] = [];
  for (const med of L.medications) {
    const t = L.treatments.find((x) => x.medicationId === med.id && patientIds.has(x.patientId));
    if (!t) continue;
    const phases = L.phases.filter((p) => p.treatmentId === t.id).sort((a, b) => a.order - b.order);
    const day = dayDiff(t.startDate, today) + 1;
    const current = (day >= 1 ? phases.find((p) => day >= p.startDay && (p.endDay === null || day <= p.endDay)) : undefined) ?? phases[0];
    const first = phases[0]?.firstDoseTime ?? "08:00";
    const per = current?.doseAmount ?? 1;
    const every = current?.intervalHours ?? 24;
    const unit = med.controlUnit as ControlUnit;
    medsVM.push({
      id: med.id,
      patientId: t.patientId,
      name: med.name,
      alternatives: med.alternativeNames,
      route: med.route,
      routeLabel: ROUTE_LABEL[med.route],
      unitLabel: UNIT_LABEL[unit],
      ...(med.dropsPerMl ? { dropsPerMl: med.dropsPerMl } : {}),
      doseText: `${qtyText(per)} ${unitNoun(unit, med.route, per)}`,
      scheduleText: every === 24 ? "1 vez ao dia" : `de ${qtyText(every)} em ${qtyText(every)} h`,
      phaseText: phases.length <= 1 ? "Uso contínuo" : `Fase ${current?.order ?? 1} de ${phases.length}${day >= 1 ? ` · dia ${day}` : ""}`,
      times: intervalTimes(first, every),
      perDose: per,
      phases: phases.map((p) => ({ order: p.order, everyHours: p.intervalHours ?? 24, fromDay: p.startDay, toDay: p.endDay, perDose: p.doseAmount })),
      treatmentDay: phases.length > 1 && day >= 1 ? day : null,
      firstTime: first,
      startDate: t.startDate,
      otc: !med.requiresPrescription,
      stock: stockVmFor(med, t, phases),
      rx: { kind: "none", text: "Receitas chegam no Lote 3", label: "Receitas chegam no Lote 3", icon: "description", tone: "neu", alert: false },
      replenishment: NO_REPL,
    });
  }

  const permissionRows: PermissionRowVM[] = canDo("profiles.manage")
    ? PERMISSION_GROUPS.filter((g) => g.keys.length > 0).map((g) => ({
        id: g.id,
        label: g.label,
        values: profileNames.map((pn) => {
          const prof = L.profiles.find((p) => p.name === pn);
          return g.keys.every((k) => can({ profileName: pn, permissions: permsOf(prof) }, k));
        }),
      }))
    : [];

  // ---------- Lote 2: doses ----------
  const medById = new Map(L.medications.map((m) => [m.id, m]));
  const patientById = new Map(L.patients.map((p) => [p.id, p]));
  const liveTreatment = new Set(L.treatments.map((x) => x.id));
  const domainMembers = L.members.map((m) => ({ id: m.id, name: m.name, active: m.active && !m.removedAt && m.accessState === "active", receives_family_alerts: m.receivesFamilyAlerts }));
  const p2h = (d: Date) => {
    const lp = localParts(d, ctx.timezone);
    return { date: lp.date, hhmm: `${p2(Math.floor(lp.minutes / 60))}:${p2(lp.minutes % 60)}` };
  };
  const responsibleOf = (patientId: string, at: Date): string => {
    const patient = patientById.get(patientId);
    const mode = effectiveRecipientsMode({ reminder_recipients_mode: patient?.reminderRecipientsMode ?? null }, ctx.settings);
    const r = resolveResponsible({
      assignments: L.assignments.filter((a) => a.patientId === patientId).map((a) => ({ member_id: a.memberId, weekdays: a.weekdays, start_time: a.startTime, end_time: a.endTime, priority: a.priority })),
      members: domainMembers, mode, datetime: at, tz: ctx.timezone,
    });
    if (r.responsible[0]) return r.responsible.slice(0, 2).map((m) => firstName(m.name)).join(" e ");
    const self = patient?.selfMemberId ? memberById.get(patient.selfMemberId) : undefined;
    return self ? firstName(self.name) : "Qualquer pessoa da família";
  };
  const doseVm = (d: (typeof L.doses)[number]): DoseVM | null => {
    const med = medById.get(d.medicationId);
    const patient = patientById.get(d.patientId);
    if (!med || !patient || !liveTreatment.has(d.treatmentId)) return null;
    const status = effectiveStatus(d.status, d.scheduledAt, now, ctx.settings);
    const at = p2h(d.scheduledAt);
    const elapsedMin = (now.getTime() - d.scheduledAt.getTime()) / 60_000;
    const done = d.confirmedAt ? p2h(d.confirmedAt) : null;
    const phases = L.phases.filter((p) => p.treatmentId === d.treatmentId);
    const ph = phases.find((p) => p.id === d.phaseId);
    const unit = med.controlUnit as ControlUnit;
    return {
      id: d.id,
      medicationId: d.medicationId,
      medName: med.name,
      patientId: d.patientId,
      patientName: firstName(patient.name),
      time: at.hhmm,
      status,
      doseText: `${qtyText(d.amount)} ${unitNoun(unit, med.route, d.amount)}`,
      phaseText: phases.length <= 1 ? "Uso contínuo" : `Fase ${ph?.order ?? 1} de ${phases.length}`,
      responsible: responsibleOf(d.patientId, d.scheduledAt),
      whenLabel: doseWhenLabel(status, at.hhmm, elapsedMin, done?.hhmm, at.date !== today),
      ...(d.confirmedByMemberId ? { doneBy: memberById.get(d.confirmedByMemberId)?.name ?? "" } : {}),
      ...(done ? { doneAt: done.hhmm } : {}),
      ...(d.channel ? { channel: d.channel === "whatsapp" ? ("whatsapp" as const) : ("panel" as const) } : {}),
      date: at.date,
    };
  };
  const doses = L.doses.map(doseVm).filter((d): d is DoseVM => d !== null);
  const recentTaken = L.recentTakenRows.map(doseVm).filter((d): d is DoseVM => d !== null);
  const alertCount = doses.filter((d) => d.status === "late" || d.status === "missed").length;

  // ---------- Lote 2: livro-razão (movimentações) ----------
  const itemById = new Map(L.stockItems.map((i) => [i.id, i]));
  const stockMovements: StockMovementVM[] = L.movements.map((m) => {
    const item = itemById.get(m.stockItemId);
    const med = item ? medById.get(item.medicationId) : undefined;
    const name = med?.name ?? "Remédio";
    const n = qtyText(Math.abs(m.quantity));
    const sign = m.quantity > 0 ? "+" : "−";
    const who = m.createdByMemberId ? firstName(memberById.get(m.createdByMemberId)?.name ?? "") : "";
    const note = (m.note ?? "").replace(/^(Compra|Ajuste): ?/, "");
    const when = stampLabel(m.createdAt, ctx.timezone).replace(/\/\d{4}/, "");
    let icon: string, tone: Tone, text: string;
    if (m.type === "purchase") [icon, tone, text] = ["shopping_bag", "ok", `${m.note === "Saldo inicial" ? "Saldo inicial" : "Compra"} · ${name} ${sign}${n}`];
    else if (m.type === "dose") [icon, tone, text] = ["check_circle", "neu", `Dose tomada · ${name} ${sign}${n}`];
    else if (m.note?.startsWith("undo:")) [icon, tone, text] = ["undo", "neu", `Dose desfeita · ${name} ${sign}${n}`];
    else if (m.note?.startsWith("redo:")) [icon, tone, text] = ["replay", "neu", `Dose refeita · ${name} ${sign}${n}`];
    else [icon, tone, text] = ["tune", "lt", `Ajuste · ${name} ${sign}${n}`];
    const extra = m.type === "adjustment" && !/^(undo|redo):/.test(m.note ?? "") && note && note !== "Ajuste manual" ? ` · ${note}` : m.type === "purchase" && note && note !== "Saldo inicial" ? ` · ${note}` : "";
    return { id: m.id, icon, tone, text, sub: `${when}${who ? ` · ${who}` : ""}${extra}` };
  });

  const { notices, unread } = await listNotices(ctx, now);

  const me = memberById.get(ctx.memberId);
  const todayLabel = weekdayLabel(today);
  return {
    nowLabel: `${todayLabel}/${today.slice(0, 4)} · ${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`,
    todayLabel,
    todayDate: ddmmyyyy(today),
    member: ctx.member,
    family: { name: ctx.familyName, canSwitch: false },
    patients,
    people,
    medications: medsVM,
    doses,
    recentTaken,
    prescriptions: [],
    history: [],
    interactions: [],
    stockMovements,
    profiles: profileNames,
    permissionRows,
    notifications: {
      leadDays: defaultLow,
      exceptions: L.treatments.filter((x) => x.lowStockDays !== null && medById.has(x.medicationId) && patientIds.has(x.patientId)).map((x) => ({ medicationId: x.medicationId, days: x.lowStockDays! })), receivers: {}, reminderAtTime: true, dailySummary: true,
      summaryTime: ctx.settings.daily_summary_time, repeatEveryMin: 15, lateAfterMin: ctx.settings.late_after_min,
      missedAfterMin: ctx.settings.missed_after_min, nightTo: "",
    },
    alertCount,
    notices,
    unreadNotices: unread,
    account: { email: ctx.account.email, name: me?.name ?? ctx.member.name, phonePending: me?.phonePending ?? "", phoneVerified: me?.phoneVerified ?? "" },
  };
}
