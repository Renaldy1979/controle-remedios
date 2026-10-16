import type {
  ClaimResult, ConfirmDoseInput, ConfirmDoseResult, DomainPort, DoseStatus, ExpiringPrescription, LowStockAlert,
  Row, SharablePrescription, StockOverviewLine,
} from "../ports";
import { daysBetween } from "../time";
import { MemoryFamilyData, type MemoryStore } from "./memory-data";
import { n, s, sOpt } from "../rows";

export interface FakeDomainOptions {
  /** patientId → membros que recebem o lembrete. */
  responsibleByPatient?: Record<string, string[]>;
  /** medicationId → doses por dia (para a previsão do fake). */
  dosesPerDay?: Record<string, number>;
}

const level = (days: number): "ok" | "attention" | "critical" => (days <= 7 ? "critical" : days <= 14 ? "attention" : "ok");

/**
 * Domínio FALSO só para testes e simulador. Imita o contrato esperado de `@medcuidar/domain`
 * (confirmação idempotente, livro-razão, previsão simplificada) sem reimplementar as regras reais.
 */
export class FakeDomain implements DomainPort {
  confirmCalls = 0;

  constructor(
    private readonly store: MemoryStore,
    private readonly opts: FakeDomainOptions = {},
  ) {}

  private data(familyId: string) {
    return new MemoryFamilyData(this.store, familyId);
  }

  async generateDoseEvents({ familyId, date }: { familyId: string; date: string }) {
    const data = this.data(familyId);
    let created = 0;
    for (const t of await data.find("treatments", { status: "active" })) {
      for (const phase of await data.find("treatment_phases", { treatment_id: t.$id })) {
        const times = Array.isArray(phase["times"]) ? (phase["times"] as string[]) : [];
        for (const hhmm of times) {
          const scheduledAt = new Date(`${date}T${hhmm}:00-03:00`).toISOString();
          const dup = await data.find("dose_events", { treatment_id: t.$id, scheduled_at: scheduledAt }, { limit: 1 });
          if (dup[0]) continue;
          await data.create("dose_events", {
            treatment_id: t.$id, patient_id: s(t, "patient_id"), medication_id: s(t, "medication_id"),
            scheduled_at: scheduledAt, status: "pending", amount: n(phase, "dose_amount") || 1,
          });
          created += 1;
        }
      }
    }
    return { created };
  }

  async resolveResponsible({ patientId }: { familyId: string; patientId: string; at: Date }) {
    return this.opts.responsibleByPatient?.[patientId] ?? [];
  }

  classifyDoseTiming(i: { status: DoseStatus; scheduledAt: Date; now: Date; lateAfterMin: number; missedAfterMin: number }) {
    const elapsed = (i.now.getTime() - i.scheduledAt.getTime()) / 60_000;
    if (elapsed >= i.missedAfterMin) return "missed" as const;
    if (elapsed >= i.lateAfterMin) return "late" as const;
    return "pending" as const;
  }

  async confirmDose(input: ConfirmDoseInput): Promise<ConfirmDoseResult> {
    this.confirmCalls += 1;
    const data = this.data(input.familyId);
    const dose = await data.getOrNull("dose_events", input.doseEventId);
    if (!dose) return { outcome: "not_found" };
    const ids = { patientId: s(dose, "patient_id"), medicationId: s(dose, "medication_id") };
    // Idempotência por mensagem de origem e por dose (como os índices únicos do modelo).
    if (sOpt(dose, "source_message_id") === input.sourceMessageId) return { outcome: "already_confirmed", ...ids };
    if (s(dose, "status") === "taken") return { outcome: "already_taken", ...ids };
    if (!["pending", "late"].includes(s(dose, "status"))) return { outcome: "not_found" };

    const [item] = await data.find("stock_items", { patient_id: ids.patientId, medication_id: ids.medicationId }, { limit: 1 });
    await data.update("dose_events", dose.$id, {
      status: "taken", confirmed_by_member_id: input.memberId, confirmed_at: new Date().toISOString(), channel: input.channel, source_message_id: input.sourceMessageId,
    });
    if (item) {
      await data.create("stock_movements", { stock_item_id: item.$id, type: "dose", quantity: -n(dose, "amount"), dose_event_id: dose.$id, created_by_member_id: input.memberId });
      const balance = (await data.find("stock_movements", { stock_item_id: item.$id }, { limit: 1000 })).reduce((sum, m) => sum + n(m, "quantity"), 0);
      await data.update("stock_items", item.$id, { cached_balance: balance });
    }
    return { outcome: "confirmed", ...ids };
  }

  private async lines(familyId: string, filter?: { patientId?: string; medicationId?: string }) {
    const data = this.data(familyId);
    const out: Array<StockOverviewLine & { itemId: string }> = [];
    for (const item of await data.find("stock_items", {})) {
      if (filter?.patientId && s(item, "patient_id") !== filter.patientId) continue;
      if (filter?.medicationId && s(item, "medication_id") !== filter.medicationId) continue;
      const [patient, med] = await Promise.all([data.getOrNull("patients", s(item, "patient_id")), data.getOrNull("medications", s(item, "medication_id"))]);
      if (!patient || !med) continue;
      const perDay = this.opts.dosesPerDay?.[med.$id] ?? 1;
      const [treatment] = await data.find("treatments", { patient_id: patient.$id, medication_id: med.$id }, { limit: 1 });
      const [phase] = treatment ? await data.find("treatment_phases", { treatment_id: treatment.$id }, { limit: 1 }) : [];
      const perDose = phase ? n(phase, "dose_amount") || 1 : 1;
      const daysLeft = Math.floor(n(item, "cached_balance") / (perDose * perDay));
      out.push({
        itemId: item.$id, patientId: patient.$id, patientName: s(patient, "name"), medicationId: med.$id, medicationName: s(med, "name"),
        daysLeft, level: level(daysLeft), isEstimate: item["is_estimate"] === true,
      });
    }
    return out;
  }

  async stockOverview({ familyId, patientId }: { familyId: string; patientId?: string }) {
    return (await this.lines(familyId, patientId ? { patientId } : undefined)).map(({ itemId: _i, ...l }) => l);
  }

  async checkLowStock({ familyId, patientId, medicationId }: { familyId: string; patientId?: string; medicationId?: string }): Promise<LowStockAlert[]> {
    const data = this.data(familyId);
    const alerts: LowStockAlert[] = [];
    for (const l of await this.lines(familyId, { ...(patientId ? { patientId } : {}), ...(medicationId ? { medicationId } : {}) })) {
      if (l.level === "ok") continue;
      const open = await data.find("replenishments", { patient_id: l.patientId, medication_id: l.medicationId, status: { in: ["needs_prescription", "prescription_received", "purchased"] } }, { limit: 1 });
      const repl: Row =
        open[0] ?? (await data.create("replenishments", { patient_id: l.patientId, medication_id: l.medicationId, status: "needs_prescription", triggered_by: "low_stock", opened_at: new Date().toISOString() }));
      alerts.push({
        replenishmentId: repl.$id, patientId: l.patientId, patientName: l.patientName, medicationId: l.medicationId, medicationName: l.medicationName,
        daysLeft: l.daysLeft, level: l.level as "attention" | "critical", isEstimate: l.isEstimate,
      });
    }
    return alerts;
  }

  async findExpiringPrescriptions({ familyId, today }: { familyId: string; today: string }): Promise<ExpiringPrescription[]> {
    const data = this.data(familyId);
    const out: ExpiringPrescription[] = [];
    for (const rx of await data.find("prescriptions", { status: "valid" })) {
      const validUntil = sOpt(rx, "valid_until");
      if (!validUntil) continue;
      const daysLeft = daysBetween(today, validUntil.slice(0, 10));
      if (daysLeft > 15) continue;
      const patient = await data.getOrNull("patients", s(rx, "patient_id"));
      const items = await data.find("prescription_items", { prescription_id: rx.$id });
      const meds = await Promise.all(items.map((i) => data.getOrNull("medications", s(i, "medication_id"))));
      out.push({ prescriptionId: rx.$id, patientId: s(rx, "patient_id"), patientName: patient ? s(patient, "name") : "", medications: meds.flatMap((m) => (m ? [s(m, "name")] : [])), validUntil: validUntil.slice(0, 10), daysLeft });
    }
    return out;
  }

  async claimReplenishment({ familyId, replenishmentId, memberId }: { familyId: string; replenishmentId: string; memberId: string }): Promise<ClaimResult> {
    const data = this.data(familyId);
    const repl = await data.getOrNull("replenishments", replenishmentId);
    if (!repl || ["done", "cancelled"].includes(s(repl, "status"))) return { outcome: "not_found" };
    const [patient, med, member] = await Promise.all([
      data.getOrNull("patients", s(repl, "patient_id")), data.getOrNull("medications", s(repl, "medication_id")), data.getOrNull("members", memberId),
    ]);
    const names = { patientName: patient ? s(patient, "name") : "", medicationName: med ? s(med, "name") : "" };
    const [step] = await data.find("replenishment_steps", { replenishment_id: replenishmentId, step: "owner" }, { limit: 1 });
    if (step && sOpt(step, "owner_member_id") !== memberId) {
      const owner = await data.getOrNull("members", s(step, "owner_member_id"));
      return { outcome: "taken_by_other", ...names, ownerName: owner ? s(owner, "name") : "" };
    }
    if (!step) await data.create("replenishment_steps", { replenishment_id: replenishmentId, step: "owner", owner_member_id: memberId });
    return { outcome: "claimed", ...names, ownerName: member ? s(member, "name") : "", alreadyOwner: !!step };
  }

  async getPrescriptionForSharing(input: { familyId: string; memberId: string; replenishmentId?: string; prescriptionId?: string }): Promise<SharablePrescription | null> {
    const data = this.data(input.familyId);
    let rx: Row | null = null;
    if (input.prescriptionId) rx = await data.getOrNull("prescriptions", input.prescriptionId);
    else if (input.replenishmentId) {
      const repl = await data.getOrNull("replenishments", input.replenishmentId);
      if (repl) rx = (await data.find("prescriptions", { patient_id: s(repl, "patient_id"), status: "valid" }, { limit: 1 }))[0] ?? null;
    }
    if (!rx) return null;
    const patient = await data.getOrNull("patients", s(rx, "patient_id"));
    const items = await data.find("prescription_items", { prescription_id: rx.$id });
    const meds = await Promise.all(items.map((i) => data.getOrNull("medications", s(i, "medication_id"))));
    const validUntil = sOpt(rx, "valid_until");
    return {
      prescriptionId: rx.$id, patientName: patient ? s(patient, "name") : "", doctorName: sOpt(rx, "doctor_name"), specialty: sOpt(rx, "specialty"),
      ...(validUntil ? { validUntil: validUntil.slice(0, 10) } : {}), medications: meds.flatMap((m) => (m ? [s(m, "name")] : [])),
      imageUrl: "https://arquivos.exemplo.test/receita.jpg?assinatura=temporaria", mimeType: "image/jpeg",
    };
  }
}

