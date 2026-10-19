import "server-only";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts } from "@medcuidar/domain";
import { PERMISSION_GROUPS, SYSTEM_PROFILES, can, permissionMapSchema, type ControlUnit, type PermissionMap } from "@medcuidar/shared";
import type {
  AccessState, MedicationVM, PatientVM, PermissionRowVM, PersonVM, ReplenishmentVM, Role, Snapshot, StockVM,
} from "@/data/types";
import { ROUTE_LABEL, UNIT_LABEL } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { intervalTimes } from "@/lib/times";
import type { Ctx } from "./access";
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

/** Lote 1 não tem doses, estoque nem receitas: os modelos de visão vêm "vazios" e as telas mostram "chega no próximo lote". */
const NO_STOCK: StockVM = { quantity: 0, quantityText: "Sem estoque registrado", approximate: false, daysLeft: 0, level: "ok", runsOutLabel: "Estoque chega no próximo lote", barPct: 0 };
const NO_REPL: ReplenishmentVM = {
  step: 0, done: false, steps: [], stepText: "", ownerText: "", ownerTone: "neu", canAssume: false, assumeLabel: "", advanceLabel: "",
  needsAttach: false, needsQuantity: false, log: [], mine: false,
};

const unitNoun = (unit: ControlUnit, route: string, n: number): string => {
  if (unit === "drop") return n === 1 ? "gota" : "gotas";
  if (unit === "ml") return "ml";
  if (unit === "gram") return "g";
  return route === "tablet" ? (n === 1 ? "comprimido" : "comprimidos") : n === 1 ? "unidade" : "unidades";
};
const qtyText = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Retrato que as telas consomem, montado do Postgres dentro de withFamilia. Já vem sem o que o perfil não pode ver. */
export async function buildSnapshot(ctx: Ctx): Promise<Snapshot> {
  const now = new Date();
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
    return { members, profiles, patients, medications, treatments, phases, invites };
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
      stock: NO_STOCK,
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
    doses: [],
    prescriptions: [],
    history: [],
    interactions: [],
    stockMovements: [],
    profiles: profileNames,
    permissionRows,
    notifications: {
      leadDays: ctx.settings.default_low_stock_days, exceptions: [], receivers: {}, reminderAtTime: true, dailySummary: true,
      summaryTime: ctx.settings.daily_summary_time, repeatEveryMin: 15, lateAfterMin: ctx.settings.late_after_min,
      missedAfterMin: ctx.settings.missed_after_min, nightTo: "",
    },
    alertCount: 0,
    account: { email: ctx.account.email, name: me?.name ?? ctx.member.name, phonePending: me?.phonePending ?? "", phoneVerified: me?.phoneVerified ?? "" },
  };
}
