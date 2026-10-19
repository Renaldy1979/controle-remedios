/**
 * Implementação MOCK de DataSource. Os cálculos aqui (dias de estoque, situação da
 * receita, rótulos de tempo) são apenas o suficiente para as telas funcionarem
 * com dados fictícios; a regra oficial virá de packages/domain na Fase 3.
 */
import { PERMISSION_GROUPS, SYSTEM_PROFILES, can, type DoseStatus, type PermissionMap } from "@medcuidar/shared";
import { addDays, fmtDate, fmtDuration, fmtShort, fmtTime, fmtWeekday, parseDate, plural } from "@/lib/format";
import { DOSE_STATUS, RX_STATUS } from "@/lib/status";
import type {
  Actions,
  AttachDraft,
  DataSource,
  DoseVM,
  HistoryEntryVM,
  InteractionVM,
  Member,
  MedicationPatch,
  MedicationVM,
  MedRxLinkVM,
  NotificationSettingsVM,
  PersonVM,
  ReplenishmentVM,
  ReplStepVM,
  Role,
  RxStatusVM,
  RxVM,
  Snapshot,
  StockLevel,
  StockVM,
  Tone,
} from "../types";
import {
  EVENTS,
  INITIAL_DOSES,
  INITIAL_STOCK,
  INTERACTIONS,
  MEDS,
  NOW,
  PATIENTS,
  PEOPLE,
  REPL,
  RX,
  SEED_MOVEMENTS,
  STEPS,
  YESTERDAY,
  type RawDose,
  type RawEvent,
  type RawMed,
  type RawRepl,
  type RawRx,
} from "./seed";

interface Move {
  id: string;
  medId: string;
  delta: number;
  type: "purchase" | "dose" | "adjustment";
  ref?: string;
  text?: string;
  sub?: string;
}

interface Raw {
  memberId: string;
  doses: Record<string, RawDose>;
  moves: Move[];
  rx: RawRx[];
  rxDeleted: Record<string, true>;
  repl: Record<string, RawRepl>;
  events: RawEvent[];
  interactions: Array<{ time: string; icon: string; tone: string; text: string; sub: string }>;
  profilePerms: Record<string, PermissionMap>;
  alertsRow: Record<string, boolean>;
  notif: NotificationSettingsVM;
  medPatch: Record<string, MedicationPatch>;
  medDeleted: Record<string, true>;
}

const ROLE_BY_PROFILE: Record<string, Role> = { Administrador: "admin", Familiar: "family", Cuidadora: "caregiver", Confirmador: "confirmer" };
const nowStamp = () => `${fmtShort(NOW)} · ${fmtTime(NOW)}`;
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const NOW_MIN = NOW.getHours() * 60 + NOW.getMinutes();

function responsibleFor(patientId: string, time: string): string {
  const h = Number(time.slice(0, 2));
  if (patientId === "ad" && h >= 6 && h < 9) return "Adelino";
  if (h < 6 || h >= 22) return "Seu João";
  return h < 14 ? "Rosa" : "Lúcia";
}

function initialRaw(): Raw {
  const profilePerms: Record<string, PermissionMap> = {};
  const alertsRow: Record<string, boolean> = {};
  for (const p of SYSTEM_PROFILES) {
    profilePerms[p.name] = { ...p.permissions };
    alertsRow[p.name] = p.name !== "Confirmador";
  }
  return {
    memberId: "ana",
    doses: { ...INITIAL_DOSES },
    moves: Object.entries(INITIAL_STOCK).map(([medId, delta]) => ({ id: `base-${medId}`, medId, delta, type: "purchase" as const })),
    rx: RX.map((r) => ({ ...r })),
    rxDeleted: {},
    repl: Object.fromEntries(Object.entries(REPL).map(([k, v]) => [k, { ...v, log: [...v.log] }])),
    events: [...EVENTS],
    interactions: INTERACTIONS.map((i) => ({ ...i })),
    profilePerms,
    alertsRow,
    notif: {
      leadDays: 7,
      exceptions: [{ medicationId: "zyp", days: 10 }],
      receivers: { Ana: true, Beatriz: true, Cláudia: true, Denise: true, Lucas: false },
      reminderAtTime: true,
      dailySummary: true,
      summaryTime: "20:00",
      repeatEveryMin: 15,
      lateAfterMin: 15,
      missedAfterMin: 120,
      nightTo: "Seu João",
    },
    medPatch: {},
    medDeleted: {},
  };
}

// ---------- derivações de apresentação (mock) ----------

function rxStatus(r: RawRx, byId: (id: string) => RawRx | undefined, deleted: Record<string, true>): RxStatusVM {
  const dateOf = (off: number) => fmtDate(addDays(NOW, off));
  if (r.next) {
    const n = byId(r.next);
    const alive = n && !deleted[n.id];
    return { kind: "superseded", ...pick("superseded"), validityText: alive ? `Substituída pela receita de ${dateOf(n.issued)}` : "Substituída por uma receita nova", validityIcon: "swap_horiz", validityTone: "neu", soon: false };
  }
  if (r.waiting) return { kind: "awaiting_new", ...pick("awaiting_new"), validityText: r.waiting, validityIcon: "hourglass_top", validityTone: "pn", soon: false };
  if (r.validity == null) return { kind: "valid", ...pick("valid"), validityText: "Sem validade informada", validityIcon: "event", validityTone: "neu", soon: false };
  const left = r.issued + r.validity;
  if (left < 0) return { kind: "expired", ...pick("expired"), validityText: `Venceu há ${plural(-left, "dia", "dias")} · ${dateOf(left)}`, validityIcon: "event_busy", validityTone: "ms", soon: false, daysLeft: left };
  const soon = left <= 15;
  return {
    kind: "valid",
    ...pick("valid"),
    validityText: soon ? `Vence em ${plural(left, "dia", "dias")} · ${dateOf(left)}` : `Válida até ${dateOf(left)}`,
    validityIcon: soon ? "event_upcoming" : "event_available",
    validityTone: soon ? "lt" : "neu",
    soon,
    daysLeft: left,
  };
}

function pick(k: keyof typeof RX_STATUS) {
  const s = RX_STATUS[k];
  return { label: s.label, icon: s.icon, tone: s.tone };
}

function stockOf(m: RawMed, qty: number, perDose: number): StockVM {
  const daysLeft = Math.floor(qty / (m.times.length * perDose));
  const level: StockLevel = daysLeft <= 7 ? "critical" : daysLeft <= 14 ? "warning" : "ok";
  let quantityText = `${qty} ${m.word}`;
  if (m.id === "zyp") quantityText = `≈ ${(qty / 20).toFixed(1).replace(".", ",")} ml · ${qty} gotas`;
  else if (m.unit === "ml") quantityText = `≈ ${qty} ml`;
  return {
    quantity: qty,
    quantityText,
    approximate: !!m.approx,
    approximateNote: m.approx ? "gotas por ml configurável; confira o frasco de vez em quando." : undefined,
    daysLeft,
    level,
    runsOutLabel: `acaba ${fmtWeekday(addDays(NOW, daysLeft))}`,
    barPct: Math.min(100, Math.round((daysLeft / 30) * 100)),
  };
}

export class MockDataSource implements DataSource {
  readonly kind = "mock" as const;
  private raw: Raw = initialRaw();
  private snap: Snapshot | null = null;
  private listeners = new Set<() => void>();
  private seq = 0;

  previewStockDays = (medId: string, delta: number): number => {
    const m = this.getSnapshot().medications.find((x) => x.id === medId);
    if (!m) return 0;
    return Math.max(0, Math.floor((m.stock.quantity + delta) / (m.times.length * m.perDose)));
  };

  getSnapshot = (): Snapshot => {
    if (!this.snap) this.snap = this.build();
    return this.snap;
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(fn: (r: Raw) => Raw) {
    this.raw = fn(this.raw);
    this.snap = null;
    this.listeners.forEach((l) => l());
  }

  private member(): Member {
    const p = PEOPLE.find((x) => x.id === this.raw.memberId) ?? PEOPLE[0]!;
    return { id: p.id, name: p.name, profileName: p.profileName, permissions: this.raw.profilePerms[p.profileName] ?? {} };
  }

  private addEvent(e: Omit<RawEvent, "day" | "time" | "who" | "channel"> & { channel?: string }, r: Raw): Raw {
    return { ...r, events: [{ day: "today", time: fmtTime(NOW), who: this.member().name, channel: "Painel", ...e }, ...r.events] };
  }

  // ---------- snapshot ----------

  private build(): Snapshot {
    const r = this.raw;
    const member = this.member();
    const stockOfMed = (id: string) => r.moves.filter((m) => m.medId === id).reduce((s, m) => s + m.delta, 0);
    const rxById = (id: string) => r.rx.find((x) => x.id === id);
    const liveRx = r.rx.filter((x) => !r.rxDeleted[x.id]);
    const medName = (id: string) => r.medPatch[id]?.name ?? MEDS.find((m) => m.id === id)?.name ?? id;
    const patientName = (id: string) => PATIENTS.find((p) => p.id === id)?.name ?? id;

    const rxLink = (m: RawMed): MedRxLinkVM => {
      const rs = liveRx.filter((x) => x.meds.includes(m.id)).sort((a, b) => b.issued - a.issued);
      const withSt = rs.map((x) => ({ x, st: rxStatus(x, rxById, r.rxDeleted) }));
      const vig = withSt.find((y) => y.st.kind === "valid");
      if (vig) {
        const soon = vig.st.soon;
        return { kind: soon ? "soon" : "ok", rxId: vig.x.id, alert: false, tone: soon ? "lt" : "ok", icon: soon ? "event_upcoming" : "verified", text: soon ? `Receita vence em ${vig.st.daysLeft} dias` : "Receita vigente", label: soon ? `Receita vence em ${vig.st.daysLeft} dias · ver` : `Receita vigente até ${fmtDate(addDays(NOW, vig.st.daysLeft ?? 0))} · ver` };
      }
      const agu = withSt.find((y) => y.st.kind === "awaiting_new");
      if (agu) return { kind: "awaiting", rxId: agu.x.id, alert: true, tone: "pn", icon: "hourglass_top", text: "Aguardando nova receita", label: "Aguardando nova receita · ver" };
      if (m.otc) return { kind: "otc", alert: false, tone: "neu", icon: "check", text: "Não precisa de receita", label: "Não precisa de receita" };
      const ven = withSt.find((y) => y.st.kind === "expired");
      if (ven) return { kind: "expired", rxId: ven.x.id, alert: true, tone: "ms", icon: "event_busy", text: "Sem receita vigente: pedir ao médico", label: "Receita vencida · pedir ao médico" };
      return { kind: "none", alert: true, tone: "ms", icon: "error", text: "Sem receita anexada", label: "Sem receita · anexar" };
    };

    const replOf = (m: RawMed, link: MedRxLinkVM): ReplenishmentVM => {
      const raw = r.repl[m.id] ?? { step: m.otc ? 2 : 0, owner: null, since: null, log: [] };
      const done = raw.step >= 4;
      const who = (n: string) => (n === member.name ? "Você" : n);
      const steps = STEPS.map(([label, verb], i) => {
        const skip = !!m.otc && i < 2;
        const isDone = !skip && i < raw.step;
        const cur = !done && i === raw.step;
        const lg = raw.log.filter((l) => l.step === i && !l.text.startsWith("Assumiu")).slice(-1)[0];
        const kind: ReplStepVM["kind"] = skip ? "skip" : isDone ? "done" : cur ? "cur" : "todo";
        const stateLabel = { skip: "Não se aplica", done: "Concluída", cur: "Etapa atual", todo: "A fazer" }[kind];
        const text = skip ? "Vendido sem receita" : isDone ? (lg ? `${who(lg.who)} · ${lg.at}` : "Concluída") : cur ? (raw.owner ? `${who(raw.owner)} ${verb} · desde ${raw.since}` : "Ninguém assumiu ainda") : "";
        return { n: i + 1, label, kind, stateLabel, text, textTone: (cur && !raw.owner ? "lt" : "neu") as Tone };
      });
      const cs = done ? null : STEPS[raw.step]!;
      const mine = raw.owner === member.name;
      return {
        step: raw.step,
        done,
        owner: raw.owner ?? undefined,
        steps,
        stepText: done ? "concluída" : `etapa ${raw.step + 1} de 4 · ${cs![0].toLowerCase()}`,
        ownerText: done ? "Reposição concluída" : raw.owner ? `${who(raw.owner)} ${cs![1]}` : "Ninguém assumiu ainda",
        ownerTone: done ? "ok" : raw.owner ? "neu" : "lt",
        canAssume: !done && !mine,
        assumeLabel: raw.owner && !mine ? "Assumir no lugar" : "Eu cuido disso",
        advanceLabel: done ? "" : raw.step === 1 && link.kind !== "ok" && link.kind !== "soon" ? "Anexar receita recebida" : "Marcar como feito",
        needsAttach: !done && raw.step === 1 && link.kind !== "ok" && link.kind !== "soon",
        needsQuantity: !done && raw.step === 2,
        log: raw.log.slice().reverse().map((l) => ({ text: l.text, sub: `${who(l.who)} · ${l.at} · ${STEPS[l.step]![0]}` })),
        mine,
      };
    };

    const medications: MedicationVM[] = MEDS.filter((m) => !r.medDeleted[m.id]).map((m) => {
      const patch = r.medPatch[m.id] ?? {};
      const perDose = patch.perDose ?? m.perDose;
      const link = rxLink(m);
      return {
        id: m.id,
        patientId: m.patientId,
        name: patch.name ?? m.name,
        alternatives: patch.alternatives ?? m.alternatives,
        route: m.route,
        routeLabel: patch.routeLabel ?? m.routeLabel,
        unitLabel: m.unitLabel,
        doseText: m.doseText,
        scheduleText: m.scheduleText,
        phaseText: m.phaseText,
        times: m.times,
        perDose,
        phases:
          m.id === "zyp"
            ? [
                { order: 1, everyHours: 3, fromDay: 1, toDay: 15, perDose },
                { order: 2, everyHours: 6, fromDay: 16, toDay: 20, perDose },
              ]
            : [{ order: 1, everyHours: 24 / m.times.length, fromDay: 1, toDay: null, perDose }],
        treatmentDay: m.id === "zyp" ? 7 : null,
        firstTime: m.times[0]!,
        otc: !!m.otc,
        stock: stockOf(m, stockOfMed(m.id), perDose),
        rx: link,
        replenishment: replOf(m, link),
      };
    });

    // doses de hoje
    const doses: DoseVM[] = [];
    for (const m of MEDS) {
      if (r.medDeleted[m.id]) continue;
      for (const t of m.times) {
        const id = `${m.id}-${t}`;
        const d = r.doses[id];
        const status: DoseStatus = d?.status ?? "pending";
        const diff = toMin(t) - NOW_MIN;
        let whenLabel: string;
        if (status === "taken") whenLabel = `Tomada às ${d?.at ?? t}`;
        else if (status === "missed") whenLabel = `Esquecida às ${t}`;
        else if (status === "late") whenLabel = `Atrasada há ${fmtDuration(-diff)}`;
        else if (status === "skipped") whenLabel = "Pulada";
        else whenLabel = diff > 0 ? `em ${fmtDuration(diff)}` : "agora";
        doses.push({
          id,
          medicationId: m.id,
          medName: medName(m.id),
          patientId: m.patientId,
          patientName: patientName(m.patientId),
          time: t,
          status,
          doseText: m.doseText,
          phaseText: m.phaseText,
          responsible: responsibleFor(m.patientId, t),
          whenLabel,
          doneBy: d?.by,
          doneAt: d?.at,
          channel: d?.channel,
        });
      }
    }
    doses.sort((a, b) => a.time.localeCompare(b.time));

    // receitas
    const perms = (n: string) => r.profilePerms[n] ?? {};
    const canSee = (p: { profileName: string }) => can({ profileName: p.profileName, permissions: perms(p.profileName) }, "prescriptions.view");
    const newest = new Map<string, string>();
    for (const x of liveRx.filter((y) => rxStatus(y, rxById, r.rxDeleted).kind === "valid").sort((a, b) => b.issued - a.issued)) {
      if (!newest.has(x.patientId)) newest.set(x.patientId, x.id);
    }
    const prescriptions: RxVM[] = liveRx
      .slice()
      .sort((a, b) => b.issued - a.issued)
      .map((x) => {
        const seen = new Set(x.views.map(([n]) => n));
        return {
          id: x.id,
          patientId: x.patientId,
          patientName: patientName(x.patientId),
          doctor: x.doctor,
          specialty: x.specialty,
          issuedOn: fmtDate(addDays(NOW, x.issued)),
          issuedISO: addDays(NOW, x.issued).toISOString().slice(0, 10),
          daysSinceIssue: -x.issued,
          validityDays: x.validity,
          medicationIds: x.meds,
          medNames: x.meds.map(medName),
          pages: x.pages,
          attachedBy: x.by,
          attachedAt: x.at,
          notes: x.notes,
          controlledCopies: x.copies,
          status: rxStatus(x, rxById, r.rxDeleted),
          previousId: x.prev && !r.rxDeleted[x.prev] ? x.prev : undefined,
          nextId: x.next && !r.rxDeleted[x.next] ? x.next : undefined,
          views: x.views.map(([who, when]) => ({ who, when })),
          notViewed: PEOPLE.filter((p) => canSee(p) && !seen.has(p.name)).map((p) => p.name),
          cannotView: PEOPLE.filter((p) => !canSee(p)).map((p) => p.name),
          shares: x.shares,
          latestValid: newest.get(x.patientId) === x.id,
        };
      });

    // histórico
    const history: HistoryEntryVM[] = [];
    const todayLabel = fmtWeekday(NOW);
    const yesterdayLabel = fmtWeekday(addDays(NOW, -1));
    const doseEntry = (day: "today" | "yesterday", medId: string, time: string, status: DoseStatus, who: string, at: string, channel: string): HistoryEntryVM => {
      const m = MEDS.find((x) => x.id === medId)!;
      const s = DOSE_STATUS[status];
      const detail = status === "missed" ? "Ninguém confirmou" : status === "late" && !who ? "Ainda sem confirmação" : `${who} · ${at}${channel ? ` · ${channel}` : ""}`;
      return { id: `h-${day}-${medId}-${time}`, kind: "dose", day, dayLabel: day === "today" ? todayLabel : yesterdayLabel, time, status, statusLabel: s.label, icon: s.icon, tone: s.tone, title: `${medName(medId)} · ${time}`, detail, patientId: m.patientId, medicationIds: [medId], who, channel };
    };
    for (const d of doses) {
      if (d.status === "pending") continue;
      const raw = r.doses[d.id];
      history.push(doseEntry("today", d.medicationId, d.time, d.status, raw?.by ?? "", raw?.at ?? "", raw?.channel === "panel" ? "Painel" : raw?.channel === "whatsapp" ? "WhatsApp" : ""));
    }
    for (const [medId, time, status, who, at, channel] of YESTERDAY) history.push(doseEntry("yesterday", medId, time, status, who, at, channel));
    r.events.forEach((e, i) =>
      history.push({ id: `e-${i}`, kind: e.kind, day: e.day, dayLabel: e.day === "today" ? todayLabel : yesterdayLabel, time: e.time, statusLabel: e.label, icon: e.icon, tone: e.tone as Tone, title: e.label, detail: e.detail, patientId: e.patientId, medicationIds: e.medIds, who: e.who, channel: e.channel }),
    );
    history.sort((a, b) => (a.day === b.day ? b.time.localeCompare(a.time) : a.day === "today" ? -1 : 1));

    const people: PersonVM[] = PEOPLE.map((p) => ({
      id: p.id,
      name: p.name,
      relation: p.relation,
      profileName: p.profileName,
      role: ROLE_BY_PROFILE[p.profileName] ?? "other",
      phone: p.phone,
      whatsappActive: p.whatsappActive,
      receivesAlerts: r.notif.receivers[p.name] ?? false,
      permissions: perms(p.profileName),
    }));

    const profiles = SYSTEM_PROFILES.map((p) => p.name);
    const permissionRows = PERMISSION_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      values: profiles.map((pn) => (g.keys.length === 0 ? !!r.alertsRow[pn] : g.keys.every((k) => can({ profileName: pn, permissions: perms(pn) }, k)))),
    }));

    const interactions: InteractionVM[] = r.interactions.map((i, n) => ({ id: `i${n}`, time: i.time, icon: i.icon, tone: i.tone as Tone, text: i.text, sub: i.sub }));
    const stockMovements = [
      ...r.moves.filter((m) => m.type !== "dose" && m.text).reverse().map((m) => ({ id: m.id, icon: m.type === "purchase" ? "shopping_bag" : "tune", tone: (m.type === "purchase" ? "ok" : "lt") as Tone, text: m.text!, sub: m.sub! })),
      ...SEED_MOVEMENTS.map((m, i) => ({ id: `seed${i}`, icon: m.icon, tone: m.tone as Tone, text: m.text, sub: m.sub })),
    ];

    const alertCount = doses.filter((d) => d.status === "late" || d.status === "missed").length;

    return {
      nowLabel: `${fmtWeekday(NOW)}/${NOW.getFullYear()} · ${fmtTime(NOW)}`,
      todayLabel,
      todayDate: fmtDate(NOW),
      member,
      family: { name: "Família Souza (demo)", canSwitch: false },
      patients: PATIENTS.map((p) => ({ ...p })),
      people,
      medications,
      doses,
      prescriptions,
      history,
      interactions,
      stockMovements,
      profiles,
      permissionRows,
      notifications: r.notif,
      alertCount,
    };
  }

  // ---------- ações ----------

  actions: Actions = {
    confirmDose: (id) => {
      const medId = id.split("-")[0]!;
      const med = MEDS.find((m) => m.id === medId)!;
      const m = this.member();
      this.set((r) => ({
        ...r,
        doses: { ...r.doses, [id]: { status: "taken", by: m.name, at: fmtTime(NOW), channel: "panel", before: r.doses[id]?.status === "taken" ? r.doses[id]!.before : (r.doses[id] ?? null) } },
        moves: [...r.moves.filter((x) => x.ref !== id), { id: `dose-${id}`, medId, delta: -(r.medPatch[medId]?.perDose ?? med.perDose), type: "dose", ref: id }],
        interactions: [{ time: fmtTime(NOW), icon: "check_circle", tone: "ok", text: `${m.name} confirmou pelo painel`, sub: `${r.medPatch[medId]?.name ?? med.name} · ${id.split("-")[1]}` }, ...r.interactions],
      }));
    },
    undoDose: (id) =>
      this.set((r) => {
        const rest = { ...r.doses };
        const before = rest[id]?.before;
        if (before) rest[id] = before;
        else delete rest[id];
        return { ...r, doses: rest, moves: r.moves.filter((x) => x.ref !== id), interactions: r.interactions.slice(1) };
      }),
    snoozeDose: (id, minutes) =>
      this.set((r) => ({ ...r, interactions: [{ time: fmtTime(NOW), icon: "chat", tone: "br", text: `Lembrete em ${minutes} min agendado`, sub: id.split("-")[0]! }, ...r.interactions] })),
    registerLate: (id) => this.actions.confirmDose(id),
    assumeReplenishment: (medId) => {
      const m = this.member();
      this.set((r) => {
        const cur = r.repl[medId] ?? { step: MEDS.find((x) => x.id === medId)?.otc ? 2 : 0, owner: null, since: null, log: [] };
        const verb = STEPS[cur.step]![1];
        const next: RawRepl = { ...cur, owner: m.name, since: nowStamp(), log: [...cur.log, { step: cur.step, who: m.name, at: nowStamp(), text: `Assumiu: ${verb}` }] };
        return this.addEvent({ kind: "replenishment", icon: "front_hand", tone: "br", medIds: [medId], patientId: MEDS.find((x) => x.id === medId)!.patientId, label: "Assumiu a reposição", detail: `${m.name} ${verb}` }, { ...r, repl: { ...r.repl, [medId]: next } });
      });
    },
    advanceReplenishment: (medId, opts) => {
      const m = this.member();
      this.set((r) => {
        const med = MEDS.find((x) => x.id === medId)!;
        const cur = r.repl[medId] ?? { step: med.otc ? 2 : 0, owner: null, since: null, log: [] };
        if (cur.step >= 4) return r;
        const label = STEPS[cur.step]![0];
        const next: RawRepl = { step: cur.step + 1, owner: null, since: null, log: [...cur.log, { step: cur.step, who: m.name, at: nowStamp(), text: `Concluiu: ${label.toLowerCase()}` }] };
        const add = cur.step === 3 ? (opts?.quantity ?? ({ zyp: 100, lac: 250 } as Record<string, number>)[medId] ?? 30) : 0;
        const moves: Move[] = add ? [...r.moves, { id: `buy-${++this.seq}`, medId, delta: add, type: "purchase" }] : r.moves;
        return this.addEvent({ kind: "replenishment", icon: next.step === 4 ? "task_alt" : "checklist", tone: next.step === 4 ? "ok" : "br", medIds: [medId], patientId: med.patientId, label: next.step === 4 ? "Reposição concluída" : "Etapa de reposição concluída", detail: label }, { ...r, repl: { ...r.repl, [medId]: next }, moves });
      });
    },
    saveRx: (d: AttachDraft) => {
      const m = this.member();
      const issued = parseDate(d.date) ?? NOW;
      const off = Math.round((issued.getTime() - new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime()) / 864e5);
      const validity = d.validity === "none" ? null : Number(d.validity);
      if (d.editId) {
        this.set((r) => ({ ...r, rx: r.rx.map((x) => (x.id === d.editId ? { ...x, patientId: d.patientId, doctor: d.doctor.trim(), specialty: d.specialty.trim(), issued: off, validity, meds: d.medicationIds, notes: d.notes.trim(), pages: d.pages || x.pages } : x)) }));
        return d.editId;
      }
      const id = `rx-${Date.now()}-${++this.seq}`;
      this.set((r) => {
        const replaced = r.rx.filter((x) => !r.rxDeleted[x.id] && !x.next && x.patientId === d.patientId && (x.id === d.replacesId || (x.meds.some((k) => d.medicationIds.includes(k)) && ["expired", "awaiting_new"].includes(rxStatus(x, (i) => r.rx.find((y) => y.id === i), r.rxDeleted).kind))));
        const nr: RawRx = { id, patientId: d.patientId, doctor: d.doctor.trim(), specialty: d.specialty.trim(), issued: off, validity, meds: d.medicationIds, pages: Math.max(1, d.pages), by: m.name, at: `${fmtDate(NOW)} · ${fmtTime(NOW)}`, notes: d.notes.trim(), prev: replaced[0]?.id, views: [], shares: [], ...(d.controlled ? { copies: d.copies ?? 1 } : {}) };
        const repl = { ...r.repl };
        for (const mid of d.medicationIds) {
          const cur = repl[mid];
          if (cur && cur.step <= 1) repl[mid] = { step: 2, owner: null, since: null, log: [...cur.log, { step: 1, who: m.name, at: nowStamp(), text: "Anexou a receita recebida" }] };
        }
        let next: Raw = { ...r, rx: [nr, ...r.rx.map((x) => (replaced.some((y) => y.id === x.id) ? { ...x, next: id } : x))], repl };
        next = this.addEvent({ kind: "prescription", icon: "description", tone: "ok", medIds: d.medicationIds, patientId: d.patientId, label: "Receita anexada", detail: `${nr.doctor || "Médico não informado"} · ${plural(nr.pages, "página", "páginas")}` }, next);
        if (replaced.length) next = this.addEvent({ kind: "prescription", icon: "swap_horiz", tone: "br", medIds: d.medicationIds, patientId: d.patientId, label: "Receita substituída", detail: `A receita de ${fmtDate(addDays(NOW, replaced[0]!.issued))} foi trocada pela nova` }, next);
        return next;
      });
      return id;
    },
    recordRxView: () => {},
    deleteRx: (id) => this.set((r) => ({ ...r, rxDeleted: { ...r.rxDeleted, [id]: true } })),
    restoreRx: (id) =>
      this.set((r) => {
        const rest = { ...r.rxDeleted };
        delete rest[id];
        return { ...r, rxDeleted: rest };
      }),
    markSuperseded: (id) =>
      this.set((r) => {
        const x = r.rx.find((y) => y.id === id)!;
        return this.addEvent({ kind: "prescription", icon: "swap_horiz", tone: "br", medIds: x.meds, patientId: x.patientId, label: "Receita marcada como substituída", detail: `${x.doctor} · ${fmtDate(addDays(NOW, x.issued))}` }, { ...r, rx: r.rx.map((y) => (y.id === id ? { ...y, next: "manual" } : y)) });
      }),
    shareRx: (id, target, channel) => {
      const to = target.label;
      const m = this.member();
      this.set((r) => {
        const x = r.rx.find((y) => y.id === id)!;
        const next = { ...r, rx: r.rx.map((y) => (y.id === id ? { ...y, shares: [{ to, who: m.name, at: nowStamp(), channel }, ...y.shares] } : y)) };
        return this.addEvent({ kind: "prescription", icon: "share", tone: "br", medIds: x.meds, patientId: x.patientId, label: "Receita compartilhada", detail: `Enviada para ${to}`, channel: channel === "WhatsApp" ? "WhatsApp" : "Painel" }, next);
      });
    },
    registerPurchase: (medId, qty) => {
      const m = this.member();
      const med = MEDS.find((x) => x.id === medId)!;
      this.set((r) => ({ ...r, moves: [...r.moves, { id: `buy-${++this.seq}`, medId, delta: qty, type: "purchase", text: `Compra · ${r.medPatch[medId]?.name ?? med.name} +${qty}`, sub: `${fmtShort(NOW)} · ${m.name}` }] }));
    },
    adjustStock: (medId, newBalance, reason) => {
      const cur = this.getSnapshot().medications.find((x) => x.id === medId)?.stock.quantity ?? 0;
      const qty = newBalance - cur;
      const m = this.member();
      const med = MEDS.find((x) => x.id === medId)!;
      this.set((r) => ({ ...r, moves: [...r.moves, { id: `adj-${++this.seq}`, medId, delta: qty, type: "adjustment", text: `Ajuste · ${r.medPatch[medId]?.name ?? med.name} ${qty > 0 ? "+" : "−"}${Math.abs(qty)}`, sub: `${fmtShort(NOW)} · ${m.name}${reason ? ` · ${reason}` : ""}` }] }));
    },
    setPermission: (rowId, profile, value) =>
      this.set((r) => {
        const group = PERMISSION_GROUPS.find((g) => g.id === rowId);
        if (!group || profile === "Administrador") return r;
        if (group.keys.length === 0) return { ...r, alertsRow: { ...r.alertsRow, [profile]: value } };
        const next: PermissionMap = { ...r.profilePerms[profile] };
        for (const k of group.keys) next[k] = value;
        return { ...r, profilePerms: { ...r.profilePerms, [profile]: next } };
      }),
    setNotification: (patch) => this.set((r) => ({ ...r, notif: { ...r.notif, ...patch } })),
    markNoticesRead: () => {},
    loadDoseHistory: () => null,
    updateMedication: (id, patch) => this.set((r) => ({ ...r, medPatch: { ...r.medPatch, [id]: { ...r.medPatch[id], ...patch } } })),
    saveScheme: () => {},
    inviteMember: (input) => ({ kind: input.kind ?? "whatsapp", memberName: input.name, code: "123456", expectedPhone: input.phone.replace(/\D/g, ""), expiresLabel: "amanhã" }),
    updateMember: () => {},
    removeMember: () => {},
    reactivateMember: () => {},
    resendInvite: () => null,
    revokeInvite: () => {},
    savePatient: () => null,
    deletePatient: () => {},
    createMedication: () => null,
    saveMyPhone: () => {},
    deleteMedication: (id) => this.set((r) => ({ ...r, medDeleted: { ...r.medDeleted, [id]: true } })),
    restoreMedication: (id) =>
      this.set((r) => {
        const rest = { ...r.medDeleted };
        delete rest[id];
        return { ...r, medDeleted: rest };
      }),
    viewAs: (personId) => this.set((r) => ({ ...r, memberId: personId })),
  };
}

export function createMockDataSource(): DataSource {
  return new MockDataSource();
}

