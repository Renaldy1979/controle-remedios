import "server-only";
import { daysBetween, medicationPrescriptionState, type PrescriptionRef } from "@medcuidar/domain";
import * as s from "@medcuidar/pg/schema";
import { can, type PermissionMap } from "@medcuidar/shared";
import type { MedRxLinkVM, ReplenishmentVM, RxVM, Tone } from "@/data/types";
import { plural } from "@/lib/format";
import { RX_STATUS } from "@/lib/status";
import { signFileUrl } from "../files";
import { STEP_LABELS, STEP_VERBS } from "./replenishment";
import { rxInfo, rxRef, type PendingRequest, type RxRow } from "./rx-state";
import { stampLabel } from "./stamp";

export interface RxLoaded {
  rows: Array<typeof s.prescriptions.$inferSelect>;
  items: Array<typeof s.prescriptionItems.$inferSelect>;
  files: Array<typeof s.prescriptionFiles.$inferSelect>;
  views: Array<typeof s.prescriptionViews.$inferSelect>;
  shares: Array<typeof s.prescriptionShares.$inferSelect>;
  /** reposições abertas e suas etapas */
  repls: Array<typeof s.replenishments.$inferSelect>;
  steps: Array<typeof s.replenishmentSteps.$inferSelect>;
}

export interface RxViewArgs {
  L: RxLoaded;
  tz: string;
  today: string;
  me: { id: string; permissions: PermissionMap; profileName: string };
  members: Array<{ id: string; name: string; active: boolean; removedAt: Date | null; accessState: string; permissions: PermissionMap; profileName: string }>;
  patients: Array<{ id: string; name: string }>;
  medications: Array<{ id: string; name: string; requiresPrescription: boolean; packageSize: number | null }>;
  familyId: string;
}

const ddmmyyyy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
const short = (d: Date, tz: string) => stampLabel(d, tz).replace(/\/\d{4}/, "");

const rowOf = (r: RxLoaded["rows"][number]): RxRow => ({ id: r.id, patientId: r.patientId, issuedOn: r.issuedOn, validUntil: r.validUntil, status: r.status, supersededById: r.supersededById });

/** Pedido de receita em andamento (etapa 1 feita, etapa 2 não) derivado das reposições abertas. */
export function pendingFrom(L: Pick<RxLoaded, "repls" | "steps">): PendingRequest[] {
  return L.repls
    .filter((r) => r.status === "needs_prescription" && L.steps.some((st) => st.replenishmentId === r.id && st.step === 1 && !st.notApplicable && st.doneAt))
    .map((r) => ({ patientId: r.patientId, medicationId: r.medicationId }));
}

export interface RxParts {
  prescriptions: RxVM[];
  /** situação da receita de um remédio do paciente (cartões do Início e de Pacientes) */
  linkFor(patientId: string, medicationId: string): MedRxLinkVM;
  /** reposição aberta do remédio, já em texto para a tela */
  replFor(patientId: string, medicationId: string, link: MedRxLinkVM): ReplenishmentVM;
}

export const NO_REPL: ReplenishmentVM = {
  step: 0, done: false, steps: [], stepText: "", ownerText: "Nenhuma reposição aberta", ownerTone: "neu", canAssume: false, assumeLabel: "Eu cuido disso", advanceLabel: "",
  needsAttach: false, needsQuantity: false, log: [], mine: false,
};

/** Monta os modelos de visão de receitas e reposição a partir do que o `buildSnapshot` leu do Postgres. */
export async function buildRxParts(a: RxViewArgs): Promise<RxParts> {
  const { L, tz, today } = a;
  const canViewRx = can(a.me, "prescriptions.view");
  const canRepl = can(a.me, "replenishment.manage") || can(a.me, "stock.view");
  const memberName = new Map(a.members.map((m) => [m.id, m.name]));
  const medById = new Map(a.medications.map((m) => [m.id, m]));
  const patientById = new Map(a.patients.map((p) => [p.id, p]));
  const pending = pendingFrom(L);
  const medsOf = (rxId: string) => L.items.filter((i) => i.prescriptionId === rxId).map((i) => i.medicationId).filter((m) => medById.has(m));
  const info = (r: RxLoaded["rows"][number]) => rxInfo(rowOf(r), medsOf(r.id), pending, today);
  const refs: PrescriptionRef[] = L.rows.map((r) => rxRef(rowOf(r), medsOf(r.id), pending, today));
  const rowById = new Map(L.rows.map((r) => [r.id, r]));

  const linkFor = (patientId: string, medicationId: string): MedRxLinkVM => {
    const med = medById.get(medicationId);
    const otc = med ? !med.requiresPrescription : false;
    const { state, prescription } = medicationPrescriptionState(medicationId, refs.filter((r) => r.patient_id === patientId), !otc);
    const rxId = canViewRx ? prescription?.id : undefined;
    const i = prescription ? info(rowById.get(prescription.id)!) : null;
    switch (state) {
      case "valid": {
        const soon = !!i?.expiringSoon;
        const left = i?.expiresInDays ?? 0;
        return { kind: soon ? "soon" : "ok", ...(rxId ? { rxId } : {}), alert: false, tone: soon ? "lt" : "ok", icon: soon ? "event_upcoming" : "verified", text: soon ? `Receita vence em ${plural(left, "dia", "dias")}` : "Receita vigente", label: soon ? `Receita vence em ${plural(left, "dia", "dias")} · ver` : `Receita vigente${prescription?.valid_until ? ` até ${ddmmyyyy(prescription.valid_until)}` : ""} · ver` };
      }
      case "awaiting":
        return { kind: "awaiting", ...(rxId ? { rxId } : {}), alert: true, tone: "pn", icon: "hourglass_top", text: "Aguardando nova receita", label: "Aguardando nova receita · ver" };
      case "not_needed":
        return { kind: "otc", alert: false, tone: "neu", icon: "check", text: "Não precisa de receita", label: "Não precisa de receita" };
      case "expired":
        return { kind: "expired", ...(rxId ? { rxId } : {}), alert: true, tone: "ms", icon: "event_busy", text: "Sem receita vigente: pedir ao médico", label: "Receita vencida · pedir ao médico" };
      default:
        return { kind: "none", alert: true, tone: "ms", icon: "error", text: "Sem receita anexada", label: "Sem receita · anexar" };
    }
  };

  const openRepl = (patientId: string, medId: string) => L.repls.find((r) => r.patientId === patientId && r.medicationId === medId);
  const who = (id: string | null | undefined) => (id ? (id === a.me.id ? "Você" : (memberName.get(id) ?? "")) : "");

  const replFor = (patientId: string, medicationId: string, link: MedRxLinkVM): ReplenishmentVM => {
    const repl = canRepl ? openRepl(patientId, medicationId) : undefined;
    const med = medById.get(medicationId);
    if (!repl || !med) return NO_REPL;
    const steps = L.steps.filter((st) => st.replenishmentId === repl.id).sort((x, y) => x.step - y.step);
    const stepRow = (n: number) => steps.find((st) => st.step === n);
    const resolved = (n: number) => !!stepRow(n)?.doneAt || !!stepRow(n)?.notApplicable;
    const curN = [1, 2, 3, 4].find((n) => !resolved(n)) ?? 5;
    const done = curN === 5;
    const ownerOf = (n: number) => stepRow(n)?.ownerMemberId ?? null;
    const mapped = STEP_LABELS.map((label, i) => {
      const n = i + 1;
      const sd = stepRow(n);
      const skip = !!sd?.notApplicable;
      const isDone = !skip && !!sd?.doneAt;
      const cur = !done && n === curN;
      const kind = skip ? "skip" : isDone ? "done" : cur ? "cur" : "todo";
      const text = skip ? "Vendido sem receita" : isDone ? `${who(sd?.ownerMemberId)} · ${sd?.doneAt ? short(sd.doneAt, tz) : ""}` : cur ? (ownerOf(n) ? `${who(ownerOf(n))} ${STEP_VERBS[i]}${sd?.claimedAt ? ` · desde ${short(sd.claimedAt, tz)}` : ""}` : "Ninguém assumiu ainda") : "";
      return { n, label, kind: kind as "done" | "cur" | "todo" | "skip", stateLabel: { skip: "Não se aplica", done: "Concluída", cur: "Etapa atual", todo: "A fazer" }[kind], text, textTone: (cur && !ownerOf(n) ? "lt" : "neu") as Tone };
    });
    const ownerId = done ? null : ownerOf(curN);
    const mine = !!ownerId && ownerId === a.me.id;
    const needsAttach = !done && curN === 2 && link.kind !== "ok" && link.kind !== "soon";
    const log = steps
      .filter((st) => st.doneAt || st.ownerMemberId)
      .map((st) => ({ st, at: st.doneAt ?? st.claimedAt ?? repl.openedAt }))
      .sort((x, y) => y.at.getTime() - x.at.getTime())
      .map(({ st, at }) => ({
        text: st.doneAt ? `Concluiu: ${STEP_LABELS[st.step - 1]!.toLowerCase()}` : `Assumiu: ${STEP_VERBS[st.step - 1]}`,
        sub: `${who(st.ownerMemberId)} · ${short(at, tz)} · ${STEP_LABELS[st.step - 1]}`,
      }));
    return {
      step: curN - 1,
      done,
      ...(ownerId && memberName.get(ownerId) ? { owner: memberName.get(ownerId)! } : {}),
      steps: mapped,
      stepText: done ? "concluída" : `etapa ${curN} de 4 · ${STEP_LABELS[curN - 1]!.toLowerCase()}`,
      ownerText: done ? "Reposição concluída" : ownerId ? `${who(ownerId)} ${STEP_VERBS[curN - 1]}` : "Ninguém assumiu ainda",
      ownerTone: done ? "ok" : ownerId ? "neu" : "lt",
      canAssume: !done && !mine,
      assumeLabel: ownerId && !mine ? "Assumir no lugar" : "Eu cuido disso",
      advanceLabel: done ? "" : needsAttach ? "Anexar receita recebida" : "Marcar como feito",
      needsAttach,
      needsQuantity: !done && curN === 3,
      ...(med.packageSize ? { suggestedQuantity: med.packageSize } : {}),
      mine,
      log,
    };
  };

  // ---------- receitas (só para quem pode ver) ----------
  const newestValid = new Map<string, string>();
  for (const r of [...L.rows].sort((x, y) => y.issuedOn.localeCompare(x.issuedOn))) {
    if (info(r).status === "valid" && !newestValid.has(r.patientId)) newestValid.set(r.patientId, r.id);
  }
  const mayView = (m: RxViewArgs["members"][number]) => m.active && !m.removedAt && m.accessState === "active";
  const viewers = a.members.filter((m) => mayView(m) && can(m, "prescriptions.view"));
  const blocked = a.members.filter((m) => mayView(m) && !can(m, "prescriptions.view"));

  const prescriptions: RxVM[] = [];
  if (canViewRx) {
    for (const r of L.rows) {
      const i = info(r);
      const items = medsOf(r.id);
      const files = L.files.filter((f) => f.prescriptionId === r.id).sort((x, y) => x.page - y.page);
      const views = L.views.filter((v) => v.prescriptionId === r.id).sort((x, y) => y.viewedAt.getTime() - x.viewedAt.getTime());
      const seen = new Map<string, Date>();
      for (const v of views) if (!seen.has(v.memberId)) seen.set(v.memberId, v.viewedAt);
      const left = i.expiresInDays ?? 0;
      const sup = r.supersededById ? rowById.get(r.supersededById) : undefined;
      const previous = L.rows.find((x) => x.supersededById === r.id);
      const a2 = RX_STATUS[i.status];
      const validityText =
        i.status === "superseded" ? (sup ? `Substituída pela receita de ${ddmmyyyy(sup.issuedOn)}` : "Substituída por uma receita nova")
        : i.status === "awaiting_new" ? "Aguardando uma receita nova"
        : i.status === "expired" ? `Venceu há ${plural(-left, "dia", "dias")}${r.validUntil ? ` · ${ddmmyyyy(r.validUntil)}` : ""}`
        : i.noValidityInformed ? "Sem validade informada"
        : i.expiringSoon ? `Vence em ${plural(left, "dia", "dias")} · ${ddmmyyyy(r.validUntil!)}`
        : `Válida até ${ddmmyyyy(r.validUntil!)}`;
      const shares = L.shares.filter((x) => x.prescriptionId === r.id).sort((x, y) => y.sharedAt.getTime() - x.sharedAt.getTime());
      const toMe = shares.find((x) => x.targetMemberId === a.me.id && !(seen.get(a.me.id) && seen.get(a.me.id)! >= x.sharedAt));
      prescriptions.push({
        id: r.id,
        patientId: r.patientId,
        patientName: firstName(patientById.get(r.patientId)?.name ?? ""),
        doctor: r.doctorName ?? "",
        specialty: r.specialty ?? "",
        issuedOn: ddmmyyyy(r.issuedOn),
        issuedISO: r.issuedOn,
        daysSinceIssue: daysBetween(r.issuedOn, today),
        validityDays: r.validUntil ? daysBetween(r.issuedOn, r.validUntil) : null,
        medicationIds: items,
        medNames: items.map((m) => medById.get(m)?.name ?? ""),
        pages: Math.max(1, files.length),
        attachedBy: memberName.get(r.uploadedByMemberId) ?? "",
        attachedAt: stampLabel(r.createdAt, tz),
        notes: r.notes ?? "",
        ...(r.isControlled ? { controlledCopies: r.copies ?? 1 } : {}),
        status: {
          kind: i.status,
          label: a2.label,
          icon: a2.icon,
          tone: a2.tone,
          validityText,
          validityIcon: i.status === "superseded" ? "swap_horiz" : i.status === "awaiting_new" ? "hourglass_top" : i.status === "expired" ? "event_busy" : i.expiringSoon ? "event_upcoming" : i.noValidityInformed ? "event" : "event_available",
          validityTone: i.status === "expired" ? "ms" : i.status === "awaiting_new" ? "pn" : i.expiringSoon ? "lt" : "neu",
          soon: i.expiringSoon,
          ...(i.expiresInDays !== null ? { daysLeft: i.expiresInDays } : {}),
        },
        ...(previous ? { previousId: previous.id } : {}),
        ...(sup ? { nextId: sup.id } : {}),
        views: [...seen.entries()].map(([id, at]) => ({ who: memberName.get(id) ?? "", when: short(at, tz) })),
        notViewed: viewers.filter((m) => !seen.has(m.id)).map((m) => m.name),
        cannotView: blocked.map((m) => m.name),
        shares: shares.map((x) => ({ to: x.targetMemberId ? (memberName.get(x.targetMemberId) ?? "") : "WhatsApp", who: memberName.get(x.sharedByMemberId) ?? "", at: short(x.sharedAt, tz), channel: x.channel === "whatsapp" ? ("WhatsApp" as const) : ("MedCuidar" as const) })),
        ...(toMe ? { sharedWithMe: { by: firstName(memberName.get(toMe.sharedByMemberId) ?? ""), at: short(toMe.sharedAt, tz) } } : {}),
        latestValid: newestValid.get(r.patientId) === r.id,
        pageUrls: await Promise.all(files.map(async (f) => ({ thumb: await signFileUrl(f.id, "thumb", a.me.id, a.familyId), full: await signFileUrl(f.id, "full", a.me.id, a.familyId), mime: f.mime }))),
      });
    }
    prescriptions.sort((x, y) => x.daysSinceIssue - y.daysSinceIssue);
  }

  return { prescriptions, linkFor, replFor };
}
