import { dateBR as isoToBR } from "@medcuidar/channels";
import type { DataFactory, DomainPort, FamilyData, FamilyInfo, GlobalData, Logger, Monitor, Row } from "./ports";
import { enqueue, enqueueToRecipients, familyAlertRecipients, type Recipient } from "./outbox";
import { doseText, n, s, sOpt } from "./rows";
import { addMinutes, hhmmToMinutes, localDate, localMinutesOfDay, localTime } from "./time";

export interface SchedulerDeps {
  global: Pick<GlobalData, "listFamilies">;
  dataFor: DataFactory;
  domain: DomainPort;
  monitor: Monitor;
  log: Logger;
}

export interface TickReport {
  families: number;
  errors: number;
  dosesGenerated: number;
  reminders: number;
  late: number;
  missed: number;
  lowStockAlerts: number;
  prescriptionAlerts: number;
  summaries: number;
}

const empty = (): TickReport => ({
  families: 0, errors: 0, dosesGenerated: 0, reminders: 0, late: 0, missed: 0, lowStockAlerts: 0, prescriptionAlerts: 0, summaries: 0,
});

/** Geração de doses a cada 15 min (idempotente) em vez de todo minuto. */
const GENERATE_EVERY_MIN = 15;
/** Checagem de estoque/receitas a cada 30 min; também é disparada após cada confirmação de dose. */
const STOCK_EVERY_MIN = 30;
/** Receitas: avisar quando faltarem estes dias (um aviso por limiar). */
const PRESCRIPTION_THRESHOLDS = [15, 7, 3, 0];

/**
 * Um passo do cron de 1 minuto. Roda por família; falha de uma família não derruba as outras.
 * Toda decisão de negócio (responsável, tempo da dose, estoque) vem das portas de domínio.
 */
export async function runSchedulerTick(deps: SchedulerDeps, now: Date): Promise<TickReport> {
  const report = empty();
  const families = await deps.global.listFamilies();
  report.families = families.length;
  for (const family of families) {
    try {
      await tickFamily(deps, family, deps.dataFor(family.id), now, report);
    } catch (e) {
      report.errors += 1;
      deps.log.error("scheduler.family_failed", { familyId: family.id, error: e instanceof Error ? e.name : "unknown" });
      await deps.monitor.alert({ kind: "scheduler_error", details: { familyId: family.id } });
    }
  }
  await deps.monitor.heartbeat("scheduler", { families: report.families, errors: report.errors, at: now.toISOString() });
  return report;
}

async function tickFamily(deps: SchedulerDeps, family: FamilyInfo, data: FamilyData, now: Date, report: TickReport) {
  const tz = family.timezone;
  const minuteOfHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "numeric" }).format(now));
  const familyId = family.id;

  // 1) Doses do dia (idempotente no domínio).
  if (minuteOfHour % GENERATE_EVERY_MIN === 0) {
    const res = await deps.domain.generateDoseEvents({ familyId, date: localDate(now, tz) });
    report.dosesGenerated += res.created;
  }

  // 2) Lembretes, atraso e esquecimento.
  await processDoses(deps, family, data, now, report);

  // 3) Estoque e receitas.
  if (minuteOfHour % STOCK_EVERY_MIN === 0) {
    const recipients = await familyAlertRecipients(data, family);
    const alerts = await deps.domain.checkLowStock({ familyId });
    for (const a of alerts) {
      report.lowStockAlerts += await enqueueToRecipients(
        data,
        recipients,
        {
          kind: "low_stock",
          template: "low_stock",
          params: { familyId, replenishmentId: a.replenishmentId, patientName: a.patientName, medicationName: a.medicationName, daysLeft: a.daysLeft, level: a.level, isEstimate: a.isEstimate },
          dedupeKey: `low_stock:${a.replenishmentId}:${a.level}`,
        },
        now,
      );
    }
    const today = localDate(now, tz);
    for (const p of await deps.domain.findExpiringPrescriptions({ familyId, today })) {
      const threshold = PRESCRIPTION_THRESHOLDS.find((t) => p.daysLeft <= t);
      if (threshold === undefined) continue;
      report.prescriptionAlerts += await enqueueToRecipients(
        data,
        recipients,
        {
          kind: "prescription_expiring",
          template: "prescription_expiring",
          params: { patientName: p.patientName, medications: p.medications, daysLeft: p.daysLeft, validUntil: isoToBR(p.validUntil) },
          dedupeKey: `rx_expiring:${p.prescriptionId}:${threshold}`,
        },
        now,
      );
    }
  }

  // 4) Resumo diário.
  if (await maybeEnqueueDailySummary(deps, family, data, now)) report.summaries += 1;
}

interface Lookups {
  patients: Map<string, Row>;
  medications: Map<string, Row>;
}

async function loadLookups(data: FamilyData): Promise<Lookups> {
  const [patients, medications] = await Promise.all([data.find("patients", {}, { limit: 200 }), data.find("medications", {}, { limit: 500 })]);
  return { patients: new Map(patients.map((p) => [p.$id, p])), medications: new Map(medications.map((m) => [m.$id, m])) };
}

async function processDoses(deps: SchedulerDeps, family: FamilyInfo, data: FamilyData, now: Date, report: TickReport) {
  const { settings } = family;
  const familyId = family.id;
  const tz = family.timezone;
  const horizon = addMinutes(now, settings.default_reminder_lead_min).toISOString();
  const floor = addMinutes(now, -24 * 60).toISOString();
  const doses = await data.find(
    "dose_events",
    { status: { in: ["pending", "late"] }, scheduled_at: { lte: horizon, gte: floor } },
    { limit: 200, orderBy: "scheduled_at", order: "asc" },
  );
  if (doses.length === 0) return;
  const lookups = await loadLookups(data);
  const alertRecipients = await familyAlertRecipients(data, family);

  for (const dose of doses) {
    const scheduledAt = new Date(s(dose, "scheduled_at"));
    const status = s(dose, "status") as "pending" | "late";
    const timing = deps.domain.classifyDoseTiming({
      status, scheduledAt, now, lateAfterMin: settings.late_after_min, missedAfterMin: settings.missed_after_min,
    });
    const patient = lookups.patients.get(s(dose, "patient_id"));
    const medication = lookups.medications.get(s(dose, "medication_id"));
    if (!patient || !medication) continue;
    const patientName = s(patient, "name");
    const medicationName = s(medication, "name");
    const time = localTime(scheduledAt, tz);

    if (timing === "missed") {
      await data.update("dose_events", dose.$id, { status: "missed" });
      report.missed += 1;
      const responsible = await deps.domain.resolveResponsible({ familyId, patientId: s(dose, "patient_id"), at: scheduledAt });
      const targets = mergeRecipients(alertRecipients, responsible);
      // Telefone de quem era responsável, para o botão "Ligar" (primeiro com telefone).
      const callPhone = await firstPhone(data, responsible);
      await enqueueToRecipients(
        data,
        targets,
        {
          kind: "dose_missed",
          template: "dose_missed_family",
          params: { familyId, doseEventId: dose.$id, patientName, medicationName, time, ...(callPhone ? { callPhone } : {}) },
          dedupeKey: `dose_missed:${dose.$id}`,
        },
        now,
      );
      continue;
    }

    if (timing === "late" && status !== "late") {
      await data.update("dose_events", dose.$id, { status: "late" });
      report.late += 1;
    }

    const retryAt = addMinutes(scheduledAt, settings.default_reminder_retry_min);
    const isLate = now >= retryAt;
    const responsible = await deps.domain.resolveResponsible({ familyId, patientId: s(dose, "patient_id"), at: scheduledAt });
    for (const memberId of responsible) {
      const params = {
        familyId,
        doseEventId: dose.$id,
        patientName,
        medicationName,
        doseText: doseText(n(dose, "amount"), medication),
        time,
        snoozeMin: settings.repeat_reminder_options_min[0] ?? 15,
      };
      const first = await enqueue(
        data,
        { kind: "dose_reminder", template: "dose_reminder", params: { ...params, late: isLate }, targetMemberId: memberId, dedupeKey: `dose_reminder:${dose.$id}:${memberId}:1` },
        now,
      );
      if (first.created) report.reminders += 1;
      // Reenvio único após `reminder_retry_min` contados do PRIMEIRO envio (não do horário da dose),
      // para uma recuperação do agendador não mandar dois lembretes de uma vez.
      if (!first.created && isLate) {
        const firstRow = await data.get("notifications_outbox", first.id);
        const firstAt = new Date(String(firstRow.$createdAt ?? now.toISOString()));
        if (addMinutes(firstAt, settings.default_reminder_retry_min) <= now) {
          const again = await enqueue(
            data,
            { kind: "dose_reminder", template: "dose_reminder", params: { ...params, late: true }, targetMemberId: memberId, dedupeKey: `dose_reminder:${dose.$id}:${memberId}:2` },
            now,
          );
          if (again.created) report.reminders += 1;
        }
      }
    }
  }
}

function mergeRecipients(base: Recipient[], memberIds: string[]): Recipient[] {
  const out = [...base];
  for (const id of memberIds) if (!out.some((r) => r.memberId === id)) out.push({ memberId: id });
  return out;
}

async function firstPhone(data: FamilyData, memberIds: string[]): Promise<string | undefined> {
  for (const id of memberIds) {
    const m = await data.getOrNull("members", id);
    const phone = m ? sOpt(m, "phone_e164") : undefined;
    if (phone) return phone;
  }
  return undefined;
}

async function maybeEnqueueDailySummary(deps: SchedulerDeps, family: FamilyInfo, data: FamilyData, now: Date): Promise<boolean> {
  const tz = family.timezone;
  const at = hhmmToMinutes(family.settings.daily_summary_time);
  const current = localMinutesOfDay(now, tz);
  // Janela de 3 h depois do horário: cobre uma queda curta do agendador; o dedupe garante um só resumo.
  if (current < at || current > at + 180) return false;
  const date = localDate(now, tz);
  const probe = `${family.id}:summary:${family.id}:${date}`;
  const exists = await data.find("notifications_outbox", { dedupe_key: { in: [`${probe}:group`] } }, { limit: 1 });
  if (exists[0]) return false;
  const recipients = await familyAlertRecipients(data, family);
  if (recipients.length === 0) return false;
  // Se algum destinatário individual já foi enfileirado hoje, o resumo já saiu.
  const first = recipients[0]!;
  const key = (r: Recipient) => `${probe}:${r.groupId ? "group" : r.memberId}`;
  if ((await data.find("notifications_outbox", { dedupe_key: key(first) }, { limit: 1 }))[0]) return false;

  const lookups = await loadLookups(data);
  const dayStart = new Date(`${date}T00:00:00Z`);
  // Doses do dia local: janela ampla em UTC, filtrada pela data local.
  const wide = await data.find(
    "dose_events",
    { scheduled_at: { gte: addMinutes(dayStart, -24 * 60).toISOString(), lte: addMinutes(dayStart, 48 * 60).toISOString() } },
    { limit: 500 },
  );
  const today = wide.filter((d) => localDate(new Date(s(d, "scheduled_at")), tz) === date);
  const byPatient = new Map<string, { name: string; taken: number; missed: number; pending: number }>();
  for (const d of today) {
    const p = lookups.patients.get(s(d, "patient_id"));
    if (!p) continue;
    const entry = byPatient.get(p.$id) ?? { name: s(p, "name"), taken: 0, missed: 0, pending: 0 };
    const st = s(d, "status");
    if (st === "taken") entry.taken += 1;
    else if (st === "missed") entry.missed += 1;
    else if (st === "pending" || st === "late") entry.pending += 1;
    byPatient.set(p.$id, entry);
  }
  const stock = await deps.domain.stockOverview({ familyId: family.id });
  const open = await data.find("replenishments", { status: { in: ["needs_prescription", "prescription_received", "purchased"] } }, { limit: 100 });

  await enqueueToRecipients(
    data,
    recipients,
    {
      kind: "daily_summary",
      template: "daily_summary",
      params: {
        date: isoToBR(date),
        patients: [...byPatient.values()],
        criticalStock: stock.filter((x) => x.level === "critical").map((x) => ({ patientName: x.patientName, medicationName: x.medicationName, daysLeft: x.daysLeft, isEstimate: x.isEstimate })),
        openReplenishments: open.length,
      },
      dedupeKey: `summary:${family.id}:${date}`,
    },
    now,
  );
  return true;
}

