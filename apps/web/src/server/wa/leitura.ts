import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { addDays, localParts, prescriptionStatus, zonedToUtc } from "@medcuidar/domain";
import { requirePermission } from "../pg/guard";
import { effectiveStatus } from "../pg/doses";
import type { WaActor } from "./actor";

/**
 * Serviços de LEITURA compartilhados pela API `/api/v1` e pelas ferramentas do agente de IA. Cada função exige a permissão do ator
 * (o mesmo perfil que o membro tem no portal) e roda em `withFamilia` (RLS). Nenhuma escreve.
 */

const p2 = (n: number) => String(n).padStart(2, "0");
export const hhmm = (d: Date, tz: string) => {
  const { minutes } = localParts(d, tz);
  return `${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`;
};
const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

export async function lerDosesDoDia(actor: WaActor, data: string, agora: Date) {
  requirePermission(actor, "dashboard.view");
  const ini = zonedToUtc(data, 0, actor.timezone);
  const fim = zonedToUtc(addDays(data, 1), 0, actor.timezone);
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ d: s.doseEvents, med: s.medications.name, patient: s.patients.name })
      .from(s.doseEvents)
      .innerJoin(s.treatments, eq(s.treatments.id, s.doseEvents.treatmentId))
      .innerJoin(s.medications, eq(s.medications.id, s.doseEvents.medicationId))
      .innerJoin(s.patients, eq(s.patients.id, s.doseEvents.patientId))
      .where(and(gte(s.doseEvents.scheduledAt, ini), lt(s.doseEvents.scheduledAt, fim), isNull(s.treatments.deletedAt)))
      .orderBy(asc(s.doseEvents.scheduledAt));
    return {
      data,
      doses: rows.map(({ d, med, patient }) => ({
        id: d.id, pacienteId: d.patientId, paciente: primeiro(patient), remedioId: d.medicationId, remedio: med,
        hora: hhmm(d.scheduledAt, actor.timezone), situacao: effectiveStatus(d.status, d.scheduledAt, agora, actor.settings),
        confirmadaPor: d.confirmedByMemberId ?? null, canal: d.channel ?? null,
      })),
    };
  });
}

export async function lerReposicoes(actor: WaActor) {
  requirePermission(actor, "stock.view");
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ r: s.replenishments, med: s.medications.name, patient: s.patients.name })
      .from(s.replenishments)
      .innerJoin(s.medications, eq(s.medications.id, s.replenishments.medicationId))
      .innerJoin(s.patients, eq(s.patients.id, s.replenishments.patientId))
      .where(notInArray(s.replenishments.status, ["done", "cancelled"]));
    const steps = rows.length ? await tx.select().from(s.replenishmentSteps).where(inArray(s.replenishmentSteps.replenishmentId, rows.map((x) => x.r.id))) : [];
    return rows.map(({ r, med, patient }) => ({
      id: r.id, remedioId: r.medicationId, pacienteId: r.patientId, paciente: primeiro(patient), remedio: med, situacao: r.status, abertaEm: r.openedAt.toISOString(),
      etapas: steps.filter((e) => e.replenishmentId === r.id).sort((a, b) => a.step - b.step).map((e) => ({ etapa: e.step, responsavelId: e.ownerMemberId, concluida: e.doneAt !== null, naoSeAplica: e.notApplicable })),
    }));
  });
}

/** Receitas com situação calculada. Só com acesso completo (`active`) e a permissão de ver receitas. */
export async function lerReceitas(actor: WaActor, agora: Date) {
  requirePermission(actor, "prescriptions.view");
  const hoje = localParts(agora, actor.timezone).date;
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ r: s.prescriptions, patient: s.patients.name })
      .from(s.prescriptions)
      .innerJoin(s.patients, eq(s.patients.id, s.prescriptions.patientId))
      .where(isNull(s.prescriptions.deletedAt))
      .orderBy(desc(s.prescriptions.issuedOn));
    const itens = rows.length ? await tx.select().from(s.prescriptionItems).where(inArray(s.prescriptionItems.prescriptionId, rows.map((x) => x.r.id))) : [];
    return rows.map(({ r, patient }) => {
      const info = prescriptionStatus(r.issuedOn, r.validUntil, hoje, { supersededById: r.supersededById ?? (r.status === "superseded" ? "manual" : null), hasPendingRequest: false });
      return {
        id: r.id, pacienteId: r.patientId, paciente: primeiro(patient), emitidaEm: r.issuedOn, validaAte: r.validUntil, situacao: info.status,
        remedioIds: itens.filter((i) => i.prescriptionId === r.id).map((i) => i.medicationId),
      };
    });
  });
}
