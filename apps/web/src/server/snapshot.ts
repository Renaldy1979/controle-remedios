import "server-only";
import {
  dosesPerDay,
  forecastDepletion,
  generateDoseEvents,
  localParts,
  lowStockStatus,
  medicationPrescriptionState,
  prescriptionStatus,
  resolveResponsible,
  daysBetween,
  type CareAssignment,
  type Member as DomainMember,
  type PrescriptionRef,
  type Treatment,
  type TreatmentPhase,
} from "@medcuidar/domain";
import { PERMISSION_GROUPS, SYSTEM_PROFILES, can, parseJsonField, permissionMapSchema, type DoseStatus, type MedRoute, type PermissionMap } from "@medcuidar/shared";
import { Query } from "node-appwrite";
import type {
  HistoryEntryVM,
  InteractionVM,
  MedicationVM,
  MedRxLinkVM,
  PatientVM,
  PersonVM,
  PhaseVM,
  ReplenishmentVM,
  Role,
  RxVM,
  Snapshot,
  StockLevel,
  StockMovementVM,
  Tone,
} from "@/data/types";
import { DOSE_STATUS, RX_STATUS } from "@/lib/status";
import { fmtDuration, plural } from "@/lib/format";
import type { Ctx } from "./context";
import { listAll, num, parseMeta, str, strList, type R } from "./data";
import { signFileUrl } from "./files";

const ROLE_BY_PROFILE: Record<string, Role> = { Administrador: "admin", Familiar: "family", Cuidadora: "caregiver", Confirmador: "confirmer" };
const ROUTE_LABEL: Record<MedRoute, string> = { drops: "Pingar", tablet: "Comprimido", powder: "Pó dissolvido", liquid: "Líquido", ointment: "Pomada", other: "Outro" };
const UNIT_LABEL: Record<string, string> = { drop: "Gotas", unit: "Unidade", ml: "ml", gram: "Grama" };
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const p2 = (n: number) => String(n).padStart(2, "0");
const localDateOf = (iso: string, tz: string) => localParts(new Date(iso), tz).date;
const hhmm = (d: Date, tz: string) => {
  const m = localParts(d, tz).minutes;
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
};
const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const weekdayLabel = (ymd: string) => `${WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}, ${ddmm(ymd)}`;
const stamp = (iso: string, tz: string) => `${ddmmyyyy(localDateOf(iso, tz))} · ${hhmm(new Date(iso), tz)}`;
const stampShort = (iso: string, tz: string) => `${ddmm(localDateOf(iso, tz))} · ${hhmm(new Date(iso), tz)}`;
export const addDaysYmd = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const formatPhone = (e164: string) => {
  const d = e164.replace(/\D/g, "").replace(/^55/, "");
  return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : e164;
};

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export interface Loaded {
  members: R[];
  profiles: R[];
  patients: R[];
  medications: R[];
  treatments: R[];
  phases: R[];
  stockItems: R[];
  movements: R[];
  doses: R[];
  prescriptions: R[];
  rxItems: R[];
  rxFiles: R[];
  rxViews: R[];
  rxShares: R[];
  repls: R[];
  replSteps: R[];
  assignments: R[];
  audit: R[];
}

const toTreatment = (r: R, familyId: string): Treatment => ({
  id: r.$id,
  family_id: familyId,
  patient_id: str(r, "patient_id"),
  medication_id: str(r, "medication_id"),
  start_date: localDateOf(str(r, "start_date"), "America/Sao_Paulo"),
  end_date: r["end_date"] ? localDateOf(str(r, "end_date"), "America/Sao_Paulo") : null,
  status: str(r, "status") as Treatment["status"],
  low_stock_days: r["low_stock_days"] == null ? null : num(r, "low_stock_days"),
});

const toPhase = (r: R): TreatmentPhase => ({
  id: r.$id,
  treatment_id: str(r, "treatment_id"),
  order: num(r, "order"),
  start_day: num(r, "start_day"),
  end_day: r["end_day"] == null ? null : num(r, "end_day"),
  schedule_type: str(r, "schedule_type") as TreatmentPhase["schedule_type"],
  interval_hours: r["interval_hours"] == null ? null : num(r, "interval_hours"),
  first_dose_time: r["first_dose_time"] ? str(r, "first_dose_time") : null,
  times: strList(r, "times"),
  dose_amount: num(r, "dose_amount"),
});

/** Cria (idempotente) os dose_events de hoje que ainda não existem. Índice único (treatment_id, scheduled_at) evita duplicar. */
async function ensureTodayDoses(ctx: Ctx, treatments: R[], phases: R[], today: string, existing: R[], liveMedIds: Set<string>): Promise<R[]> {
  const created: R[] = [];
  for (const t of treatments) {
    if (str(t, "status") !== "active" || t["deleted_at"] || !liveMedIds.has(str(t, "medication_id"))) continue;
    const tr = toTreatment(t, ctx.familyId);
    const drafts = generateDoseEvents(tr, phases.filter((p) => str(p, "treatment_id") === t.$id).map(toPhase), today, ctx.timezone, existing.filter((d) => str(d, "treatment_id") === t.$id).map((d) => ({ scheduled_at: str(d, "scheduled_at") })));
    for (const d of drafts) {
      const { key: _k, ...data } = d;
      void _k;
      try {
        created.push((await ctx.db.create("dose_events", data)) as unknown as R);
      } catch (e) {
        if ((e as { code?: number }).code !== 409) throw e;
      }
    }
  }
  return created;
}

export async function loadAll(ctx: Ctx, now: Date): Promise<Loaded> {
  const db = ctx.db;
  const today = localParts(now, ctx.timezone).date;
  const from = new Date(`${addDaysYmd(today, -2)}T00:00:00Z`).toISOString();
  const [members, profiles, patients, medications, treatments, phases, stockItems, movements, doseWindow, prescriptions, rxItems, rxFiles, rxViews, rxShares, repls, replSteps, assignments, audit] = await Promise.all([
    listAll(db, "members"),
    listAll(db, "profiles"),
    listAll(db, "patients"),
    listAll(db, "medications"),
    listAll(db, "treatments"),
    listAll(db, "treatment_phases"),
    listAll(db, "stock_items"),
    listAll(db, "stock_movements", [], 5000),
    listAll(db, "dose_events", [Query.greaterThanEqual("scheduled_at", from)]),
    listAll(db, "prescriptions"),
    listAll(db, "prescription_items"),
    listAll(db, "prescription_files"),
    listAll(db, "prescription_views", [], 1000),
    listAll(db, "prescription_shares", [], 500),
    listAll(db, "replenishments"),
    listAll(db, "replenishment_steps"),
    listAll(db, "care_assignments"),
    listAll(db, "audit_log", [Query.orderDesc("at"), Query.limit(100)], 100),
  ]);
  const todayExisting = doseWindow.filter((d) => localDateOf(str(d, "scheduled_at"), ctx.timezone) === today);
  const made = await ensureTodayDoses(ctx, treatments, phases, today, todayExisting, new Set(medications.filter((m) => !m["deleted_at"]).map((m) => m.$id)));
  return { members, profiles, patients, medications, treatments, phases, stockItems, movements, doses: [...doseWindow, ...made], prescriptions, rxItems, rxFiles, rxViews, rxShares, repls, replSteps, assignments, audit };
}

export async function buildSnapshot(ctx: Ctx, now = new Date()): Promise<Snapshot> {
  const L = await loadAll(ctx, now);
  const snap = mapSnapshot(ctx, L, now);
  // páginas das receitas: URLs assinadas de curta duração (só quem pode ver receitas recebe)
  const prescriptions = await Promise.all(
    snap.prescriptions.map(async (rx) => {
      const files = L.rxFiles.filter((f) => str(f, "prescription_id") === rx.id).sort((a, b) => num(a, "page") - num(b, "page"));
      if (files.length === 0) return rx;
      const pageUrls = await Promise.all(files.map(async (f) => ({ thumb: await signFileUrl(f.$id, "thumb", ctx.member.id, ctx.familyId), full: await signFileUrl(f.$id, "full", ctx.member.id, ctx.familyId), mime: str(f, "mime") })));
      return { ...rx, pageUrls };
    }),
  );
  return { ...snap, prescriptions };
}

/** Mapeamento puro dos dados lidos para os modelos de visão (testável sem rede). */
export function mapSnapshot(ctx: Ctx, L: Loaded, now: Date): Snapshot {
  const tz = ctx.timezone;
  const today = localParts(now, tz).date;
  const yesterday = addDaysYmd(today, -1);
  const member = ctx.member;
  const canDo = (k: Parameters<typeof can>[1]) => can(member, k);
  const live = (rows: R[]) => rows.filter((r) => !r["deleted_at"]);

  const memberName = new Map(L.members.map((m) => [m.$id, str(m, "name")]));
  const profileById = new Map(L.profiles.map((p) => [p.$id, p]));
  const profileOf = (m: R) => profileById.get(str(m, "profile_id"));
  const permsOf = (p: R | undefined): PermissionMap => {
    try {
      return p ? parseJsonField(permissionMapSchema, str(p, "permissions") || "{}") : {};
    } catch {
      return {};
    }
  };
  const canViewRx = (m: R) => can({ profileName: str(profileOf(m), "name"), permissions: permsOf(profileOf(m)) }, "prescriptions.view");

  const patients = live(L.patients).filter((p) => p["active"] !== false);
  const medications = live(L.medications);
  const medById = new Map(medications.map((m) => [m.$id, m]));
  const patientById = new Map(patients.map((p) => [p.$id, p]));
  const treatments = live(L.treatments).filter((t) => str(t, "status") !== "finished");

  // ---------- estoque ----------
  const balanceOfItem = new Map<string, number>();
  for (const mv of L.movements) balanceOfItem.set(str(mv, "stock_item_id"), (balanceOfItem.get(str(mv, "stock_item_id")) ?? 0) + num(mv, "quantity"));
  const itemFor = (patientId: string, medId: string) => L.stockItems.find((s) => str(s, "patient_id") === patientId && str(s, "medication_id") === medId);

  // ---------- receitas ----------
  const openRepls = L.repls.filter((r) => !["done", "cancelled"].includes(str(r, "status")));
  const stepsOf = (replId: string) => L.replSteps.filter((s) => str(s, "replenishment_id") === replId).sort((a, b) => num(a, "step") - num(b, "step"));
  const rxLive = live(L.prescriptions);
  const rxMeds = (id: string) => L.rxItems.filter((i) => str(i, "prescription_id") === id).map((i) => str(i, "medication_id"));
  const pendingRequestFor = (rx: R) =>
    str(rx, "status") === "awaiting_new" ||
    openRepls.some((r) => rxMeds(rx.$id).includes(str(r, "medication_id")) && str(r, "patient_id") === str(rx, "patient_id") && str(r, "status") === "needs_prescription" && stepsOf(r.$id).some((s) => num(s, "step") === 1 && s["done_at"]));
  const rxInfo = (rx: R) =>
    prescriptionStatus(localDateOf(str(rx, "issued_on"), tz), rx["valid_until"] ? localDateOf(str(rx, "valid_until"), tz) : null, today, {
      supersededById: str(rx, "superseded_by_id") || (str(rx, "status") === "superseded" ? "manual" : null),
      hasPendingRequest: pendingRequestFor(rx),
    });
  const rxRefs: PrescriptionRef[] = rxLive.map((rx) => ({
    id: rx.$id,
    patient_id: str(rx, "patient_id"),
    status: rxInfo(rx).status,
    medication_ids: rxMeds(rx.$id),
    valid_until: rx["valid_until"] ? localDateOf(str(rx, "valid_until"), tz) : null,
    issued_on: localDateOf(str(rx, "issued_on"), tz),
  }));

  const rxLinkFor = (patientId: string, med: R): MedRxLinkVM => {
    const otc = med["requires_prescription"] === false;
    const refs = rxRefs.filter((r) => r.patient_id === patientId);
    const { state, prescription } = medicationPrescriptionState(med.$id, refs, !otc);
    const show = canDo("prescriptions.view");
    const rxId = show ? prescription?.id : undefined;
    const info = prescription ? rxInfo(rxLive.find((r) => r.$id === prescription.id)!) : null;
    switch (state) {
      case "valid": {
        const soon = !!info?.expiringSoon;
        const left = info?.expiresInDays ?? 0;
        return { kind: soon ? "soon" : "ok", rxId, alert: false, tone: soon ? "lt" : "ok", icon: soon ? "event_upcoming" : "verified", text: soon ? `Receita vence em ${left} dias` : "Receita vigente", label: soon ? `Receita vence em ${left} dias · ver` : `Receita vigente${prescription?.valid_until ? ` até ${ddmmyyyy(prescription.valid_until)}` : ""} · ver` };
      }
      case "awaiting":
        return { kind: "awaiting", rxId, alert: true, tone: "pn", icon: "hourglass_top", text: "Aguardando nova receita", label: "Aguardando nova receita · ver" };
      case "not_needed":
        return { kind: "otc", alert: false, tone: "neu", icon: "check", text: "Não precisa de receita", label: "Não precisa de receita" };
      case "expired":
        return { kind: "expired", rxId, alert: true, tone: "ms", icon: "event_busy", text: "Sem receita vigente: pedir ao médico", label: "Receita vencida · pedir ao médico" };
      default:
        return { kind: "none", alert: true, tone: "ms", icon: "error", text: "Sem receita anexada", label: "Sem receita · anexar" };
    }
  };

  // ---------- doses de hoje (e ontem p/ histórico) ----------
  const settings = ctx.settings;
  const assignmentsByPatient = new Map<string, CareAssignment[]>();
  for (const a of L.assignments) {
    const list = assignmentsByPatient.get(str(a, "patient_id")) ?? [];
    list.push({ member_id: str(a, "member_id"), weekdays: (a["weekdays"] as number[] | undefined) ?? [], start_time: str(a, "start_time"), end_time: str(a, "end_time"), priority: num(a, "priority") });
    assignmentsByPatient.set(str(a, "patient_id"), list);
  }
  const domainMembers: DomainMember[] = L.members.map((m) => ({ id: m.$id, name: str(m, "name"), active: m["active"] === true, receives_family_alerts: m["receives_family_alerts"] === true }));
  const classify = (status: DoseStatus, scheduledAt: string): DoseStatus => {
    if (status !== "pending" && status !== "late") return status;
    const min = (now.getTime() - new Date(scheduledAt).getTime()) / 60000;
    if (min >= settings.missed_after_min) return "missed";
    if (min >= settings.late_after_min) return "late";
    return "pending";
  };
  const treatmentById = new Map(treatments.map((t) => [t.$id, t]));

  // dias de estoque por tratamento
  const forecastFor = (t: R) => {
    const item = itemFor(str(t, "patient_id"), str(t, "medication_id"));
    const med = medById.get(str(t, "medication_id"));
    const tr = toTreatment(t, ctx.familyId);
    const phases = L.phases.filter((p) => str(p, "treatment_id") === t.$id).map(toPhase);
    const balance = item ? (balanceOfItem.get(item.$id) ?? 0) : 0;
    const f = forecastDepletion({ balance, is_estimate: item?.["is_estimate"] === true }, tr, phases, now, tz);
    const threshold = tr.low_stock_days ?? settings.default_low_stock_days;
    return { item, med, balance, phases, forecast: f, threshold, tr };
  };

  const stockVisible = canDo("stock.view");
  const medsVM: MedicationVM[] = treatments.flatMap((t): MedicationVM[] => {
    const f = forecastFor(t);
    const med = f.med;
    const patient = patientById.get(str(t, "patient_id"));
    if (!med || !patient) return [];
    const phasesSorted = [...f.phases].sort((a, b) => a.order - b.order);
    const dayNo = daysBetween(f.tr.start_date, today) + 1;
    const cur = phasesSorted.find((p) => dayNo >= p.start_day && (p.end_day === null || dayNo <= p.end_day)) ?? phasesSorted[phasesSorted.length - 1];
    const control = str(med, "control_unit");
    const word = control === "drop" ? "gotas" : control === "ml" ? "ml" : control === "gram" ? "g" : med["route"] === "tablet" ? "comprimidos" : "unidades";
    const amount = cur?.dose_amount ?? 1;
    const perDay = cur ? dosesPerDay(cur) : 0;
    const level: StockLevel = ((): StockLevel => {
      const s = lowStockStatus(f.forecast.daysLeft, f.threshold);
      return s === "critical" ? "critical" : s === "attention" ? "warning" : "ok";
    })();
    const daysLeft = f.forecast.daysLeft ?? 365;
    const dpm = num(med, "drops_per_ml") || 20;
    const qty = Math.round(f.balance * 1000) / 1000;
    const quantityText = control === "drop" ? `≈ ${(qty / dpm).toFixed(1).replace(".", ",")} ml · ${qty} gotas` : control === "ml" ? `≈ ${qty} ml` : `${qty} ${word}`;
    const approximate = f.item?.["is_estimate"] === true || control === "drop" || control === "ml";
    const stockVM = stockVisible
      ? {
          quantity: qty,
          quantityText,
          approximate,
          approximateNote: approximate ? "gotas por ml configurável; confira o frasco de vez em quando." : undefined,
          daysLeft,
          level,
          runsOutLabel: f.forecast.depletionDate ? `acaba ${weekdayLabel(addDaysYmd(today, daysLeft))}` : "estoque cobre o tratamento",
          barPct: Math.min(100, Math.round((daysLeft / 30) * 100)),
        }
      : { quantity: 0, quantityText: "", approximate: false, daysLeft: 0, level: "ok" as StockLevel, runsOutLabel: "", barPct: 0 };
    const link = rxLinkFor(str(t, "patient_id"), med);
    const alternatives = strList(med, "alternative_names");
    const phases: PhaseVM[] = phasesSorted.map((p) => ({ order: p.order, everyHours: p.schedule_type === "interval" ? (p.interval_hours ?? 24) : 24 / Math.max(1, (p.times ?? []).length), fromDay: p.start_day, toDay: p.end_day, perDose: p.dose_amount }));
    const times = L.doses
      .filter((d) => str(d, "treatment_id") === t.$id && localDateOf(str(d, "scheduled_at"), tz) === today)
      .map((d) => hhmm(new Date(str(d, "scheduled_at")), tz))
      .sort();
    const multi = phasesSorted.length > 1;
    return [
      {
        id: med.$id,
        patientId: patient.$id,
        name: str(med, "name"),
        alternatives: alternatives.length ? [str(med, "name"), ...alternatives] : [],
        route: str(med, "route") as MedRoute,
        routeLabel: ROUTE_LABEL[str(med, "route") as MedRoute] ?? "Outro",
        unitLabel: UNIT_LABEL[control] ?? "Unidade",
        doseText: `${amount} ${amount === 1 ? word.replace(/^gotas$/, "gota").replace(/^comprimidos$/, "comprimido").replace(/^unidades$/, "unidade") : word}`,
        scheduleText: cur?.schedule_type === "interval" ? `De ${cur.interval_hours} em ${cur.interval_hours} horas` : perDay === 1 ? "Uma vez ao dia" : `${perDay} vezes ao dia`,
        phaseText: multi && cur ? `Fase ${cur.order} de ${phasesSorted.length} · dia ${dayNo} de ${phasesSorted[phasesSorted.length - 1]!.end_day ?? "?"}` : cur?.end_day == null ? "Uso contínuo" : `Dia ${dayNo} de ${cur.end_day}`,
        times,
        perDose: amount,
        phases,
        treatmentDay: multi ? dayNo : null,
        firstTime: cur?.first_dose_time ?? cur?.times?.[0] ?? "08:00",
        otc: med["requires_prescription"] === false,
        stock: stockVM,
        rx: link,
        replenishment: replVM(t, med, link),
      },
    ];
  });

  function replVM(t: R, med: R, link: MedRxLinkVM): ReplenishmentVM {
    const repl = openRepls.find((r) => str(r, "patient_id") === str(t, "patient_id") && str(r, "medication_id") === med.$id);
    const otc = med["requires_prescription"] === false;
    const steps = repl ? stepsOf(repl.$id) : [];
    const stepDoc = (n: number) => steps.find((s) => num(s, "step") === n);
    const resolved = (n: number) => !!stepDoc(n)?.["done_at"] || (otc && n <= 2);
    const curN = [1, 2, 3, 4].find((n) => !resolved(n)) ?? 5;
    const done = curN === 5;
    const who = (id: string | undefined) => (id ? (id === member.id ? "Você" : (memberName.get(id) ?? "")) : "");
    const VERBS = ["vai pedir a receita", "vai buscar a receita", "vai comprar", "vai atualizar o estoque"];
    const LABELS = ["Pedir receita ao médico", "Receita recebida", "Comprado", "Estoque atualizado"];
    const ownerOf = (n: number) => str(stepDoc(n), "owner_member_id");
    const mapped = LABELS.map((label, i) => {
      const n = i + 1;
      const skip = otc && n <= 2;
      const isDone = !skip && resolved(n);
      const cur = !done && n === curN;
      const kind = skip ? "skip" : isDone ? "done" : cur ? "cur" : "todo";
      const sd = stepDoc(n);
      const text = skip ? "Vendido sem receita" : isDone ? `${who(ownerOf(n))} · ${sd?.["done_at"] ? stampShort(str(sd, "done_at"), tz) : ""}` : cur ? (ownerOf(n) ? `${who(ownerOf(n))} ${VERBS[i]} · desde ${stampShort(str(sd, "$updatedAt"), tz)}` : "Ninguém assumiu ainda") : "";
      return { n, label, kind: kind as "done" | "cur" | "todo" | "skip", stateLabel: { skip: "Não se aplica", done: "Concluída", cur: "Etapa atual", todo: "A fazer" }[kind], text, textTone: (cur && !ownerOf(n) ? "lt" : "neu") as Tone };
    });
    const ownerId = done ? "" : ownerOf(curN);
    const mine = !!ownerId && ownerId === member.id;
    const needsAttach = !done && curN === 2 && link.kind !== "ok" && link.kind !== "soon";
    return {
      step: curN - 1,
      done,
      owner: ownerId ? (memberName.get(ownerId) ?? undefined) : undefined,
      steps: mapped,
      stepText: done ? "concluída" : `etapa ${curN} de 4 · ${LABELS[curN - 1]!.toLowerCase()}`,
      ownerText: done ? "Reposição concluída" : ownerId ? `${who(ownerId)} ${VERBS[curN - 1]}` : "Ninguém assumiu ainda",
      ownerTone: done ? "ok" : ownerId ? "neu" : "lt",
      canAssume: !done && !mine,
      assumeLabel: ownerId && !mine ? "Assumir no lugar" : "Eu cuido disso",
      advanceLabel: done ? "" : needsAttach ? "Anexar receita recebida" : "Marcar como feito",
      needsAttach,
      needsQuantity: !done && curN === 3,
      suggestedQuantity: num(med, "package_size") || undefined,
      mine,
      log: steps
        .filter((s) => s["done_at"] || s["owner_member_id"])
        .sort((a, b) => str(b, "$updatedAt").localeCompare(str(a, "$updatedAt")))
        .map((s) => {
          const n = num(s, "step");
          const doneAt = s["done_at"] ? str(s, "done_at") : "";
          return { text: doneAt ? `Concluiu: ${LABELS[n - 1]!.toLowerCase()}` : `Assumiu: ${VERBS[n - 1]}`, sub: `${who(str(s, "owner_member_id"))} · ${stampShort(doneAt || str(s, "$updatedAt"), tz)} · ${LABELS[n - 1]}` };
        }),
    };
  }

  const medVMByKey = new Map(medsVM.map((m) => [`${m.patientId}|${m.id}`, m]));

  const dosesVM = L.doses
    .filter((d) => localDateOf(str(d, "scheduled_at"), tz) === today && treatmentById.has(str(d, "treatment_id")))
    .map((d) => {
      const mv = medVMByKey.get(`${str(d, "patient_id")}|${str(d, "medication_id")}`);
      const patient = patientById.get(str(d, "patient_id"));
      if (!mv || !patient) return null;
      const status = classify(str(d, "status") as DoseStatus, str(d, "scheduled_at"));
      const at = new Date(str(d, "scheduled_at"));
      const time = hhmm(at, tz);
      const diff = Math.round((at.getTime() - now.getTime()) / 60000);
      const whenLabel = status === "taken" ? `Tomada às ${d["confirmed_at"] ? hhmm(new Date(str(d, "confirmed_at")), tz) : time}` : status === "missed" ? `Esquecida às ${time}` : status === "late" ? `Atrasada há ${fmtDuration(-diff)}` : status === "skipped" ? "Pulada" : diff > 0 ? `em ${fmtDuration(diff)}` : "agora";
      const resolved = resolveResponsible({ assignments: assignmentsByPatient.get(patient.$id) ?? [], members: domainMembers, mode: "assignments_only", datetime: at, tz });
      const channel = str(d, "channel");
      return {
        id: d.$id,
        medicationId: mv.id,
        medName: mv.name,
        patientId: patient.$id,
        patientName: firstName(str(patient, "name")),
        time,
        status,
        doseText: mv.doseText,
        phaseText: mv.phaseText,
        responsible: resolved.responsible[0]?.name ?? "Família",
        whenLabel,
        doneBy: d["confirmed_by_member_id"] ? memberName.get(str(d, "confirmed_by_member_id")) : undefined,
        doneAt: d["confirmed_at"] ? hhmm(new Date(str(d, "confirmed_at")), tz) : undefined,
        channel: channel === "whatsapp" ? ("whatsapp" as const) : channel ? ("panel" as const) : undefined,
        _at: at.getTime(),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a._at - b._at)
    .map(({ _at, ...rest }) => (void _at, rest));

  // ---------- receitas VM ----------
  const newestValid = new Map<string, string>();
  for (const rx of [...rxLive].sort((a, b) => str(b, "issued_on").localeCompare(str(a, "issued_on")))) {
    if (rxInfo(rx).status === "valid" && !newestValid.has(str(rx, "patient_id"))) newestValid.set(str(rx, "patient_id"), rx.$id);
  }
  const prescriptions: RxVM[] = canDo("prescriptions.view")
    ? rxLive
        .map((rx): RxVM => {
          const info = rxInfo(rx);
          const issued = localDateOf(str(rx, "issued_on"), tz);
          const validUntil = rx["valid_until"] ? localDateOf(str(rx, "valid_until"), tz) : null;
          const items = rxMeds(rx.$id);
          const views = L.rxViews.filter((v) => str(v, "prescription_id") === rx.$id).sort((a, b) => str(b, "viewed_at").localeCompare(str(a, "viewed_at")));
          const seenIds = new Set(views.map((v) => str(v, "member_id")));
          const seen = new Map<string, string>();
          for (const v of views) if (!seen.has(str(v, "member_id"))) seen.set(str(v, "member_id"), stampShort(str(v, "viewed_at"), tz));
          const a = RX_STATUS[info.status];
          const left = info.expiresInDays ?? 0;
          const supersededBy = rxLive.find((r) => r.$id === str(rx, "superseded_by_id"));
          const validityText = info.status === "superseded" ? (supersededBy ? `Substituída pela receita de ${ddmmyyyy(localDateOf(str(supersededBy, "issued_on"), tz))}` : "Substituída por uma receita nova") : info.status === "awaiting_new" ? "Aguardando uma receita nova" : info.status === "expired" ? `Venceu há ${plural(-left, "dia", "dias")}${validUntil ? ` · ${ddmmyyyy(validUntil)}` : ""}` : info.noValidityInformed ? "Sem validade informada" : info.expiringSoon ? `Vence em ${plural(left, "dia", "dias")} · ${ddmmyyyy(validUntil!)}` : `Válida até ${ddmmyyyy(validUntil!)}`;
          return {
            id: rx.$id,
            patientId: str(rx, "patient_id"),
            patientName: firstName(str(patientById.get(str(rx, "patient_id")), "name")),
            doctor: str(rx, "doctor_name"),
            specialty: str(rx, "specialty"),
            issuedOn: ddmmyyyy(issued),
            issuedISO: issued,
            daysSinceIssue: daysBetween(issued, today),
            validityDays: validUntil ? daysBetween(issued, validUntil) : null,
            medicationIds: items,
            medNames: items.map((i) => str(medById.get(i), "name")),
            pages: Math.max(1, L.rxFiles.filter((f) => str(f, "prescription_id") === rx.$id).length),
            attachedBy: memberName.get(str(rx, "uploaded_by_member_id")) ?? "",
            attachedAt: stamp(rx.$createdAt, tz),
            notes: str(rx, "notes"),
            controlledCopies: rx["is_controlled"] === true ? num(rx, "copies") || 1 : undefined,
            status: {
              kind: info.status,
              label: a.label,
              icon: a.icon,
              tone: a.tone,
              validityText,
              validityIcon: info.status === "superseded" ? "swap_horiz" : info.status === "awaiting_new" ? "hourglass_top" : info.status === "expired" ? "event_busy" : info.expiringSoon ? "event_upcoming" : info.noValidityInformed ? "event" : "event_available",
              validityTone: info.status === "expired" ? "ms" : info.status === "awaiting_new" ? "pn" : info.expiringSoon ? "lt" : "neu",
              soon: info.expiringSoon,
              daysLeft: info.expiresInDays ?? undefined,
            },
            previousId: rxLive.find((r) => str(r, "superseded_by_id") === rx.$id)?.$id,
            nextId: supersededBy?.$id,
            views: [...seen.entries()].map(([id, when]) => ({ who: memberName.get(id) ?? "", when })),
            notViewed: L.members.filter((m) => m["active"] === true && canViewRx(m) && !seenIds.has(m.$id)).map((m) => str(m, "name")),
            cannotView: L.members.filter((m) => m["active"] === true && !canViewRx(m)).map((m) => str(m, "name")),
            shares: L.rxShares
              .filter((s) => str(s, "prescription_id") === rx.$id)
              .sort((x, y) => str(y, "shared_at").localeCompare(str(x, "shared_at")))
              .map((s) => ({ to: s["target_member_id"] ? (memberName.get(str(s, "target_member_id")) ?? "") : str(s, "target_phone") ? "WhatsApp" : "", who: memberName.get(str(s, "shared_by_member_id")) ?? "", at: stampShort(str(s, "shared_at"), tz), channel: str(s, "channel") === "whatsapp" ? ("WhatsApp" as const) : ("MedCuidar" as const) })),
            latestValid: newestValid.get(str(rx, "patient_id")) === rx.$id,
          };
        })
        .sort((a, b) => a.daysSinceIssue - b.daysSinceIssue)
    : [];

  // ---------- histórico ----------
  const dayOf = (iso: string): "today" | "yesterday" | null => {
    const d = localDateOf(iso, tz);
    return d === today ? "today" : d === yesterday ? "yesterday" : null;
  };
  const history: HistoryEntryVM[] = [];
  if (canDo("doses.history.view")) {
    for (const d of L.doses) {
      const day = dayOf(str(d, "scheduled_at"));
      const mv = medVMByKey.get(`${str(d, "patient_id")}|${str(d, "medication_id")}`);
      if (!day || !mv) continue;
      const status = classify(str(d, "status") as DoseStatus, str(d, "scheduled_at"));
      if (status === "pending") continue;
      const s = DOSE_STATUS[status];
      const time = hhmm(new Date(str(d, "scheduled_at")), tz);
      const who = d["confirmed_by_member_id"] ? (memberName.get(str(d, "confirmed_by_member_id")) ?? "") : "";
      const ch = str(d, "channel") === "whatsapp" ? "WhatsApp" : str(d, "channel") ? "Painel" : "";
      const at = d["confirmed_at"] ? hhmm(new Date(str(d, "confirmed_at")), tz) : "";
      history.push({ id: `h-${d.$id}`, kind: "dose", day, dayLabel: weekdayLabel(day === "today" ? today : yesterday), time, status, statusLabel: s.label, icon: s.icon, tone: s.tone, title: `${mv.name} · ${time}`, detail: status === "missed" ? "Ninguém confirmou" : status === "late" && !who ? "Ainda sem confirmação" : `${who} · ${at}${ch ? ` · ${ch}` : ""}`, patientId: str(d, "patient_id"), medicationIds: [mv.id], who, channel: ch });
    }
    const EVENT: Record<string, { kind: "prescription" | "replenishment"; icon: string; tone: Tone; label: string }> = {
      "rx.attached": { kind: "prescription", icon: "description", tone: "ok", label: "Receita anexada" },
      "rx.shared": { kind: "prescription", icon: "share", tone: "br", label: "Receita compartilhada" },
      "rx.superseded": { kind: "prescription", icon: "swap_horiz", tone: "br", label: "Receita substituída" },
      "replenishment.claimed": { kind: "replenishment", icon: "front_hand", tone: "br", label: "Assumiu a reposição" },
      "replenishment.step_done": { kind: "replenishment", icon: "checklist", tone: "br", label: "Etapa de reposição concluída" },
      "replenishment.done": { kind: "replenishment", icon: "task_alt", tone: "ok", label: "Reposição concluída" },
    };
    for (const a of L.audit) {
      const spec = EVENT[str(a, "action")];
      const day = dayOf(str(a, "at"));
      if (!spec || !day) continue;
      if (spec.kind === "prescription" && !canDo("prescriptions.view")) continue;
      const meta = parseMeta(a);
      const medIds = Array.isArray(meta["medicationIds"]) ? (meta["medicationIds"] as string[]) : [];
      const patientId = String(meta["patientId"] ?? "");
      const medsText = medIds.map((i) => str(medById.get(i), "name")).filter(Boolean).join(", ");
      const who = memberName.get(str(a, "actor_member_id")) ?? "";
      const detail = spec.kind === "prescription" ? `${medsText}${meta["pages"] ? ` · ${plural(Number(meta["pages"]), "página", "páginas")}` : ""}` : medsText;
      history.push({ id: `e-${a.$id}`, kind: spec.kind, day, dayLabel: weekdayLabel(day === "today" ? today : yesterday), time: hhmm(new Date(str(a, "at")), tz), statusLabel: spec.label, icon: spec.icon, tone: spec.tone, title: spec.label, detail, patientId, medicationIds: medIds, who, channel: "Painel" });
    }
    history.sort((a, b) => (a.day === b.day ? b.time.localeCompare(a.time) : a.day === "today" ? -1 : 1));
  }

  // ---------- interações recentes ----------
  const interactions: InteractionVM[] = [];
  for (const h of history.slice(0, 6)) {
    interactions.push({ id: h.id, time: h.time, icon: h.icon, tone: h.tone, text: h.kind === "dose" ? `${h.who || "Alguém"} · ${h.statusLabel.toLowerCase()}` : h.title, sub: `${h.title}${h.detail ? ` · ${h.detail}` : ""}` });
  }

  // ---------- movimentações de estoque ----------
  const stockMovements: StockMovementVM[] = stockVisible
    ? L.movements
        .filter((m) => ["purchase", "adjustment"].includes(str(m, "type")) && !/^(undo|redo):/.test(str(m, "note")))
        .sort((a, b) => b.$createdAt.localeCompare(a.$createdAt))
        .slice(0, 20)
        .map((m) => {
          const item = L.stockItems.find((s) => s.$id === str(m, "stock_item_id"));
          const name = str(medById.get(str(item, "medication_id")), "name");
          const q = num(m, "quantity");
          const purchase = str(m, "type") === "purchase";
          return { id: m.$id, icon: purchase ? "shopping_bag" : "tune", tone: (purchase ? "ok" : "lt") as Tone, text: `${purchase ? "Compra" : "Ajuste"} · ${name} ${q > 0 ? "+" : "−"}${Math.abs(q)}`, sub: `${stampShort(m.$createdAt, tz)} · ${memberName.get(str(m, "created_by_member_id")) ?? ""}${str(m, "note") ? ` · ${str(m, "note")}` : ""}` };
        })
    : [];

  // ---------- pessoas, perfis, avisos (só para quem administra) ----------
  const canSeePeople = canDo("members.manage");
  const slotOf = (m: R) => {
    const mine = L.assignments.filter((a) => str(a, "member_id") === m.$id);
    const a = mine[0];
    if (!a) return str(m, "role_label");
    const h = (t: string) => `${Number(t.slice(0, 2))}h`;
    return `${str(m, "role_label")} · ${num(a, "priority") === 1 && str(a, "start_time") >= str(a, "end_time") ? "noite" : `${h(str(a, "start_time"))}–${h(str(a, "end_time"))}`}`;
  };
  const people: PersonVM[] = L.members
    .filter((m) => m["active"] === true)
    .map((m) => ({
      id: m.$id,
      name: str(m, "name"),
      relation: slotOf(m),
      profileName: str(profileOf(m), "name"),
      role: ROLE_BY_PROFILE[str(profileOf(m), "name")] ?? "other",
      phone: canSeePeople ? formatPhone(str(m, "phone_e164")) : "",
      whatsappActive: str(m, "whatsapp_status") === "verified" || str(m, "whatsapp_status") === "unverified",
      receivesAlerts: m["receives_family_alerts"] === true,
      permissions: permsOf(profileOf(m)),
    }));

  const profileOrder = SYSTEM_PROFILES.map((p) => p.name);
  const rank = (n: string) => (profileOrder.includes(n) ? profileOrder.indexOf(n) : 99);
  const profileNames = L.profiles.map((p) => str(p, "name")).sort((a, b) => rank(a) - rank(b));
  const permissionRows = canDo("profiles.manage")
    ? PERMISSION_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        values: profileNames.map((pn) => {
          const prof = L.profiles.find((p) => str(p, "name") === pn);
          if (g.keys.length === 0) {
            const ms = L.members.filter((m) => str(m, "profile_id") === prof?.$id && m["active"] === true);
            return ms.length > 0 && ms.every((m) => m["receives_family_alerts"] === true);
          }
          return g.keys.every((k) => can({ profileName: pn, permissions: permsOf(prof) }, k));
        }),
      }))
    : [];

  const nightAssign = L.assignments.find((a) => str(a, "start_time") >= str(a, "end_time"));
  const exceptions = treatments.filter((t) => t["low_stock_days"] != null).map((t) => ({ medicationId: str(t, "medication_id"), days: num(t, "low_stock_days") }));
  const extra = ctx.settings as unknown as Record<string, unknown>;
  const notifications = canDo("settings.manage")
    ? {
        leadDays: settings.default_low_stock_days,
        exceptions,
        receivers: Object.fromEntries(L.members.filter((m) => m["active"] === true && ["Administrador", "Familiar"].includes(str(profileOf(m), "name"))).map((m) => [str(m, "name"), m["receives_family_alerts"] === true])),
        reminderAtTime: extra["reminder_at_time"] !== false,
        dailySummary: extra["daily_summary_enabled"] !== false,
        summaryTime: settings.daily_summary_time,
        repeatEveryMin: ([15, 30, 60].includes(settings.default_reminder_retry_min) ? settings.default_reminder_retry_min : 15) as 15 | 30 | 60,
        lateAfterMin: settings.late_after_min,
        missedAfterMin: settings.missed_after_min,
        nightTo: nightAssign ? (memberName.get(str(nightAssign, "member_id")) ?? "") : "",
      }
    : { leadDays: settings.default_low_stock_days, exceptions: [], receivers: {}, reminderAtTime: true, dailySummary: true, summaryTime: settings.daily_summary_time, repeatEveryMin: 15 as const, lateAfterMin: settings.late_after_min, missedAfterMin: settings.missed_after_min, nightTo: "" };

  const patientsVM: PatientVM[] = patients.map((p) => {
    const birth = p["birth_date"] ? new Date(str(p, "birth_date")) : null;
    const age = birth ? Math.floor((now.getTime() - birth.getTime()) / (365.25 * 86_400_000)) : 0;
    const selfMember = p["self_member_id"] ? L.members.find((m) => m.$id === str(p, "self_member_id")) : undefined;
    return { id: p.$id, name: firstName(str(p, "name")), fullName: str(p, "name"), age, note: str(p, "notes"), usesPhone: p["can_use_phone"] === true, phone: p["can_use_phone"] === true && selfMember && canSeePeople ? formatPhone(str(selfMember, "phone_e164")) : p["can_use_phone"] === true ? "" : "Sem celular" };
  });

  const todayLabel = weekdayLabel(today);
  const { minutes } = localParts(now, tz);
  return {
    nowLabel: `${todayLabel}/${today.slice(0, 4)} · ${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`,
    todayLabel,
    todayDate: ddmmyyyy(today),
    member: ctx.member,
    family: { name: ctx.familyName, canSwitch: ctx.canSwitchFamily },
    patients: patientsVM,
    people,
    medications: medsVM,
    doses: dosesVM,
    prescriptions,
    history,
    interactions,
    stockMovements,
    profiles: profileNames,
    permissionRows,
    notifications,
    alertCount: dosesVM.filter((d) => d.status === "late" || d.status === "missed").length,
  };
}
