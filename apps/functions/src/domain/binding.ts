import {
  advanceReplenishment,
  confirmDose as domainConfirmDose,
  effectiveRecipientsMode,
  forecastDepletion,
  generateDoseEvents,
  lowStockStatus,
  markLateAndMissed,
  medicationPrescriptionState,
  prescriptionStatus,
  resolveResponsible,
  type PrescriptionRef,
  type Treatment,
  type TreatmentPhase,
} from "@medcuidar/domain";
import { recipientsModeSchema } from "@medcuidar/shared";
import type {
  ClaimResult,
  ConfirmDoseInput,
  ConfirmDoseResult,
  DataFactory,
  DomainPort,
  ExpiringPrescription,
  FamilyData,
  FamilyInfo,
  GlobalData,
  LowStockAlert,
  Row,
  SharablePrescription,
  StockOverviewLine,
} from "../ports";
import { isConflict, n, s, sOpt } from "../rows";
import { addMinutes, daysBetween } from "../time";
import { dateOnly, toAssignment, toMember, toPhase, toTreatment } from "./mappers";
import { loadReplenishment, ensureOpenReplenishment, saveReplenishment } from "./replenishment-repo";
import { DoseRepo, DuplicateSourceMessageError, ledgerBalance } from "./repo";

/** Resultado "cobre até o fim do tratamento": o domínio devolve `daysLeft: null`; as portas usam este valor. */
export const COVERS_UNTIL_END = 3650;

export interface FileSigner {
  /** URL de curta duração para a imagem da receita. */
  sign(storageFileId: string): Promise<{ url: string; mimeType?: string }>;
}

export interface DomainDeps {
  global: Pick<GlobalData, "listFamilies">;
  dataFor: DataFactory;
  now?: () => Date;
  signer?: FileSigner;
}

interface Evaluated {
  item: Row;
  treatment: Row;
  patient: Row;
  medication: Row;
  daysLeft: number;
  level: "ok" | "attention" | "critical";
  isEstimate: boolean;
}

/**
 * `DomainPort` real: orquestra `@medcuidar/domain` (regras puras) sobre `FamilyData`/`FamilyScopedDb`.
 * Nenhuma regra nova aqui; só leitura, mapeamento e gravação.
 */
export function createDomainPort(deps: DomainDeps): DomainPort & { repoFor(familyId: string): DoseRepo } {
  const now = deps.now ?? (() => new Date());

  const family = async (familyId: string): Promise<FamilyInfo> => {
    const f = (await deps.global.listFamilies()).find((x) => x.id === familyId);
    if (!f) throw new Error(`Família não encontrada: ${familyId}`);
    return f;
  };

  async function loadRefs(data: FamilyData, today: string, patientId?: string): Promise<PrescriptionRef[]> {
    const rxs = await data.find("prescriptions", patientId ? { patient_id: patientId } : {}, { limit: 200 });
    const out: PrescriptionRef[] = [];
    for (const rx of rxs) {
      const items = await data.find("prescription_items", { prescription_id: rx.$id }, { limit: 50 });
      const validUntil = rx["valid_until"] ? dateOnly(rx["valid_until"]) : null;
      const info = prescriptionStatus(dateOnly(rx["issued_on"]), validUntil, today, {
        supersededById: sOpt(rx, "superseded_by_id") ?? null,
        hasPendingRequest: s(rx, "status") === "awaiting_new",
      });
      out.push({
        id: rx.$id, patient_id: s(rx, "patient_id"), status: info.status, medication_ids: items.map((i) => s(i, "medication_id")),
        valid_until: validUntil, issued_on: dateOnly(rx["issued_on"]),
      });
    }
    return out;
  }

  async function evaluate(data: FamilyData, fam: FamilyInfo, filter: { patientId?: string; medicationId?: string }): Promise<Evaluated[]> {
    const where: Record<string, string> = {};
    if (filter.patientId) where["patient_id"] = filter.patientId;
    if (filter.medicationId) where["medication_id"] = filter.medicationId;
    const items = await data.find("stock_items", where, { limit: 200 });
    const out: Evaluated[] = [];
    for (const item of items) {
      const [treatments, patient, medication] = await Promise.all([
        data.find("treatments", { patient_id: s(item, "patient_id"), medication_id: s(item, "medication_id"), status: "active" }, { limit: 1 }),
        data.getOrNull("patients", s(item, "patient_id")),
        data.getOrNull("medications", s(item, "medication_id")),
      ]);
      const treatment = treatments[0];
      if (!treatment || !patient || !medication) continue;
      const phases: TreatmentPhase[] = (await data.find("treatment_phases", { treatment_id: treatment.$id }, { limit: 20 })).map(toPhase);
      let balance = await ledgerBalance(data, item.$id);
      // Colírio controlado em ml: o domínio prevê em gotas.
      if (s(item, "control_unit") === "ml" && medication["drops_per_ml"]) balance *= n(medication, "drops_per_ml");
      const isEstimate = item["is_estimate"] === true;
      const t: Treatment = toTreatment(treatment);
      const fc = forecastDepletion({ balance, is_estimate: isEstimate }, t, phases, now(), fam.timezone);
      const daysLeft = fc.daysLeft ?? COVERS_UNTIL_END;
      const threshold = t.low_stock_days ?? fam.settings.default_low_stock_days;
      out.push({ item, treatment, patient, medication, daysLeft, level: lowStockStatus(fc.daysLeft, threshold), isEstimate: isEstimate || fc.confidence === "low" });
    }
    return out;
  }

  const port: DomainPort & { repoFor(familyId: string): DoseRepo } = {
    repoFor: (familyId) => new DoseRepo(deps.dataFor(familyId), now),

    async generateDoseEvents({ familyId, date }) {
      const data = deps.dataFor(familyId);
      const fam = await family(familyId);
      let created = 0;
      const lo = new Date(`${date}T00:00:00Z`);
      for (const trow of await data.find("treatments", { status: "active" }, { limit: 200 })) {
        const phases = (await data.find("treatment_phases", { treatment_id: trow.$id }, { limit: 20 })).map(toPhase);
        const existing = await data.find(
          "dose_events",
          { treatment_id: trow.$id, scheduled_at: { gte: addMinutes(lo, -36 * 60).toISOString(), lte: addMinutes(lo, 60 * 60).toISOString() } },
          { limit: 100 },
        );
        for (const draft of generateDoseEvents(toTreatment(trow), phases, date, fam.timezone, existing.map((e) => ({ scheduled_at: s(e, "scheduled_at") })))) {
          const { key: _key, ...doc } = draft;
          void _key;
          try {
            await data.create("dose_events", doc);
            created += 1;
          } catch (e) {
            if (!isConflict(e)) throw e; // índice único (treatment_id, scheduled_at): outra execução gerou
          }
        }
      }
      return { created };
    },

    async resolveResponsible({ familyId, patientId, at }) {
      const data = deps.dataFor(familyId);
      const fam = await family(familyId);
      const [patient, assignments, members] = await Promise.all([
        data.getOrNull("patients", patientId),
        data.find("care_assignments", { patient_id: patientId }, { limit: 100 }),
        data.find("members", { active: true }, { limit: 200 }),
      ]);
      const parsed = recipientsModeSchema.safeParse(patient ? sOpt(patient, "reminder_recipients_mode") : undefined);
      const mode = effectiveRecipientsMode({ reminder_recipients_mode: parsed.success ? parsed.data : null }, fam.settings);
      const res = resolveResponsible({ assignments: assignments.map(toAssignment), members: members.map(toMember), mode, datetime: at, tz: fam.timezone });
      return res.recipients.map((m) => m.id);
    },

    classifyDoseTiming({ status, scheduledAt, now: at, lateAfterMin, missedAfterMin }) {
      if (status !== "pending" && status !== "late") return "pending";
      const [change] = markLateAndMissed(at, { late_after_min: lateAfterMin, missed_after_min: missedAfterMin }, [{ id: "x", status, scheduled_at: scheduledAt.toISOString() }]);
      return change ? change.to : status;
    },

    async confirmDose(input: ConfirmDoseInput): Promise<ConfirmDoseResult> {
      const data = deps.dataFor(input.familyId);
      const repo = new DoseRepo(data, now);
      const args = { doseId: input.doseEventId, memberId: input.memberId, channel: input.channel, sourceMessageId: input.sourceMessageId, now: now() };
      let res;
      try {
        res = await domainConfirmDose(repo, args);
      } catch (e) {
        if (!(e instanceof DuplicateSourceMessageError)) throw e;
        const dose = await repo.getDose(input.doseEventId);
        return { outcome: "already_confirmed", ...(dose ? { patientId: dose.patient_id, medicationId: dose.medication_id } : {}) };
      }
      await repo.flushBalances();
      if (res.result === "not_found" || res.result === "not_confirmable") return { outcome: "not_found" };
      const ids = { patientId: res.dose.patient_id, medicationId: res.dose.medication_id };
      if (res.result === "confirmed") return { outcome: "confirmed", ...ids };
      return { outcome: res.dose.source_message_id === input.sourceMessageId ? "already_confirmed" : "already_taken", ...ids };
    },

    async checkLowStock({ familyId, patientId, medicationId }): Promise<LowStockAlert[]> {
      const data = deps.dataFor(familyId);
      const fam = await family(familyId);
      const today = now().toISOString().slice(0, 10);
      const alerts: LowStockAlert[] = [];
      for (const ev of await evaluate(data, fam, { ...(patientId ? { patientId } : {}), ...(medicationId ? { medicationId } : {}) })) {
        if (ev.level === "ok") continue;
        const refs = await loadRefs(data, today, ev.patient.$id);
        const requires = ev.medication["requires_prescription"] !== false;
        const rx = medicationPrescriptionState(ev.medication.$id, refs, requires);
        const replId = await ensureOpenReplenishment(data, {
          patientId: ev.patient.$id, medicationId: ev.medication.$id, requiresPrescription: requires,
          validPrescriptionId: rx.state === "valid" ? rx.prescription?.id : null, now: now(),
        });
        alerts.push({
          replenishmentId: replId, patientId: ev.patient.$id, patientName: s(ev.patient, "name"), medicationId: ev.medication.$id,
          medicationName: s(ev.medication, "name"), daysLeft: ev.daysLeft, level: ev.level, isEstimate: ev.isEstimate,
        });
      }
      return alerts;
    },

    async stockOverview({ familyId, patientId }): Promise<StockOverviewLine[]> {
      const fam = await family(familyId);
      const evs = await evaluate(deps.dataFor(familyId), fam, patientId ? { patientId } : {});
      return evs.map((e) => ({
        patientId: e.patient.$id, patientName: s(e.patient, "name"), medicationId: e.medication.$id, medicationName: s(e.medication, "name"),
        daysLeft: e.daysLeft, level: e.level, isEstimate: e.isEstimate,
      }));
    },

    async findExpiringPrescriptions({ familyId, today }): Promise<ExpiringPrescription[]> {
      const data = deps.dataFor(familyId);
      const out: ExpiringPrescription[] = [];
      for (const ref of await loadRefs(data, today)) {
        if (ref.status !== "valid" || !ref.valid_until) continue;
        const daysLeft = daysBetween(today, ref.valid_until);
        if (daysLeft < 0 || daysLeft > 15) continue;
        const [patient, meds] = await Promise.all([
          data.getOrNull("patients", ref.patient_id),
          Promise.all(ref.medication_ids.map((id) => data.getOrNull("medications", id))),
        ]);
        out.push({
          prescriptionId: ref.id, patientId: ref.patient_id, patientName: patient ? s(patient, "name") : "",
          medications: meds.flatMap((m) => (m ? [s(m, "name")] : [])), validUntil: ref.valid_until, daysLeft,
        });
      }
      return out;
    },

    async claimReplenishment({ familyId, replenishmentId, memberId }): Promise<ClaimResult> {
      const data = deps.dataFor(familyId);
      const loaded = await loadReplenishment(data, replenishmentId);
      if (!loaded) return { outcome: "not_found" };
      const [patient, med, member] = await Promise.all([
        data.getOrNull("patients", loaded.patientId), data.getOrNull("medications", loaded.medicationId), data.getOrNull("members", memberId),
      ]);
      const names = { patientName: patient ? s(patient, "name") : "", medicationName: med ? s(med, "name") : "" };
      const res = advanceReplenishment(loaded.repl, { type: "claim", memberId, now: now() });
      if (!res.ok) {
        if (res.reason !== "already_claimed") return { outcome: "not_found" };
        const ownerId = loaded.repl.steps.find((x) => !x.done_at && x.owner_member_id)?.owner_member_id;
        const owner = ownerId ? await data.getOrNull("members", ownerId) : null;
        return { outcome: "taken_by_other", ...names, ownerName: owner ? s(owner, "name") : "" };
      }
      const alreadyOwner = res.replenishment === loaded.repl;
      if (!alreadyOwner) await saveReplenishment(data, loaded, res.replenishment);
      return { outcome: "claimed", ...names, ownerName: member ? s(member, "name") : "", alreadyOwner };
    },

    async getPrescriptionForSharing({ familyId, replenishmentId, prescriptionId }): Promise<SharablePrescription | null> {
      if (!deps.signer) return null;
      const data = deps.dataFor(familyId);
      const today = now().toISOString().slice(0, 10);
      let rxId = prescriptionId ?? null;
      if (!rxId && replenishmentId) {
        const loaded = await loadReplenishment(data, replenishmentId);
        if (!loaded) return null;
        const refs = await loadRefs(data, today, loaded.patientId);
        rxId = medicationPrescriptionState(loaded.medicationId, refs, loaded.requiresPrescription).prescription?.id ?? null;
      }
      const rx = rxId ? await data.getOrNull("prescriptions", rxId) : null;
      if (!rx) return null;
      const [files, items, patient] = await Promise.all([
        data.find("prescription_files", { prescription_id: rx.$id }, { limit: 20, orderBy: "page" }),
        data.find("prescription_items", { prescription_id: rx.$id }, { limit: 50 }),
        data.getOrNull("patients", s(rx, "patient_id")),
      ]);
      const first = files[0];
      if (!first) return null;
      const meds = await Promise.all(items.map((i) => data.getOrNull("medications", s(i, "medication_id"))));
      const signed = await deps.signer.sign(s(first, "storage_file_id"));
      return {
        prescriptionId: rx.$id,
        patientName: patient ? s(patient, "name") : "",
        ...(sOpt(rx, "doctor_name") ? { doctorName: s(rx, "doctor_name") } : {}),
        ...(sOpt(rx, "specialty") ? { specialty: s(rx, "specialty") } : {}),
        ...(rx["valid_until"] ? { validUntil: dateOnly(rx["valid_until"]) } : {}),
        medications: meds.flatMap((m) => (m ? [s(m, "name")] : [])),
        imageUrl: signed.url,
        mimeType: signed.mimeType ?? sOpt(first, "mime") ?? "image/jpeg",
      };
    },
  };
  return port;
}
