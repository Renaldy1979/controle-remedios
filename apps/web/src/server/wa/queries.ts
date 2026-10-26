import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { addDays, localParts, zonedToUtc } from "@medcuidar/domain";
import { can, type ControlUnit, type FamilySettings } from "@medcuidar/shared";
import { requirePermission } from "../pg/guard";
import { DEFAULT_LOW_STOCK_DAYS, computeStock, qtyText, unitNoun } from "../pg/calc";
import { effectiveStatus } from "../pg/doses";
import { toDomainPhase, toDomainTreatment } from "../pg/mappers";
import { primeiroNome, type EstoqueLinha } from "./texts";
import type { WaActor } from "./actor";

const p2 = (n: number) => String(n).padStart(2, "0");
export const horaLocal = (d: Date, tz: string): string => {
  const { minutes } = localParts(d, tz);
  return `${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`;
};

export interface DoseAberta {
  id: string;
  patientId: string;
  medicationId: string;
  paciente: string;
  remedio: string;
  hora: string;
  dose: string;
  scheduledAt: Date;
  status: "pending" | "late" | "missed";
  /** dia local (aaaa-mm-dd) da dose */
  data: string;
}

type Settings = Pick<FamilySettings, "late_after_min" | "missed_after_min">;

/**
 * Doses ainda sem resolução (pendente, atrasada, esquecida) entre `de` e `ate`, de tratamentos vivos.
 * É a base de "tomei", "próximas doses" e dos lembretes. Não filtra por permissão: quem chama decide.
 */
export async function dosesAbertas(
  tx: Tx, tz: string, settings: Settings, now: Date, janela: { de: Date; ate: Date },
): Promise<DoseAberta[]> {
  const rows = await tx
    .select({ d: s.doseEvents, med: s.medications, patient: s.patients })
    .from(s.doseEvents)
    .innerJoin(s.treatments, eq(s.treatments.id, s.doseEvents.treatmentId))
    .innerJoin(s.medications, eq(s.medications.id, s.doseEvents.medicationId))
    .innerJoin(s.patients, eq(s.patients.id, s.doseEvents.patientId))
    .where(and(
      inArray(s.doseEvents.status, ["pending", "late", "missed"]),
      gte(s.doseEvents.scheduledAt, janela.de),
      lte(s.doseEvents.scheduledAt, janela.ate),
      isNull(s.treatments.deletedAt), isNull(s.medications.deletedAt), isNull(s.patients.deletedAt),
    ))
    .orderBy(asc(s.doseEvents.scheduledAt), asc(s.doseEvents.id));
  return rows.map(({ d, med, patient }) => ({
    id: d.id,
    patientId: d.patientId,
    medicationId: d.medicationId,
    paciente: primeiroNome(patient.name),
    remedio: med.name,
    hora: horaLocal(d.scheduledAt, tz),
    dose: `${qtyText(d.amount)} ${unitNoun(med.controlUnit as ControlUnit, med.route, d.amount)}`,
    scheduledAt: d.scheduledAt,
    status: effectiveStatus(d.status, d.scheduledAt, now, settings) as DoseAberta["status"],
    data: localParts(d.scheduledAt, tz).date,
  }));
}

/** Candidatas a "tomei": já na hora (ou até 1 h antes) e até 12 h atrás. */
export function janelaConfirmacao(now: Date): { de: Date; ate: Date } {
  return { de: new Date(now.getTime() - 12 * 3600_000), ate: new Date(now.getTime() + 60 * 60_000) };
}

export async function candidatasConfirmacao(actor: WaActor, now: Date): Promise<DoseAberta[]> {
  requirePermission(actor, "doses.confirm");
  return withFamilia(actor.familyId, (tx) => dosesAbertas(tx, actor.timezone, actor.settings, now, janelaConfirmacao(now)));
}

/** "Próximas doses": o que ainda não foi resolvido hoje (e o que ficou atrasado de ontem à noite). */
export async function proximasDosesHoje(actor: WaActor, now: Date, limite = 8): Promise<Array<DoseAberta & { situacao?: string }>> {
  requirePermission(actor, "dashboard.view", "whatsapp.query");
  const { date } = localParts(now, actor.timezone);
  const fimDoDia = zonedToUtc(addDays(date, 1), 0, actor.timezone);
  const lista = await withFamilia(actor.familyId, (tx) =>
    dosesAbertas(tx, actor.timezone, actor.settings, now, { de: new Date(now.getTime() - 12 * 3600_000), ate: new Date(fimDoDia.getTime() - 1) }));
  return lista.slice(0, limite).map((d) => ({
    ...d,
    ...(d.status === "late" ? { situacao: "atrasada" } : d.status === "missed" ? { situacao: "esquecida" } : {}),
  }));
}

/** Estoque por remédio/paciente com a previsão do domínio (mesma conta do portal). Exige `stock.view`. */
export type LinhaEstoque = EstoqueLinha & { stockItemId: string; medicationId: string; patientId: string; quantidadeNumero: number; unidade: ControlUnit; via: string };

export async function visaoEstoque(actor: WaActor, now: Date): Promise<LinhaEstoque[]> {
  requirePermission(actor, "stock.view", "whatsapp.query");
  return withFamilia(actor.familyId, (tx) => estoqueDaFamilia(tx, actor.timezone, actor.settings.default_low_stock_days ?? DEFAULT_LOW_STOCK_DAYS, now));
}

export async function estoqueDaFamilia(tx: Tx, tz: string, defaultLow: number, now: Date) {
  const items = await tx.select().from(s.stockItems);
  if (items.length === 0) return [];
  const [meds, pats, treats, sums] = await Promise.all([
    tx.select().from(s.medications).where(isNull(s.medications.deletedAt)),
    tx.select().from(s.patients).where(isNull(s.patients.deletedAt)),
    tx.select().from(s.treatments).where(isNull(s.treatments.deletedAt)),
    tx.select({ id: s.stockMovements.stockItemId, total: sql<number>`coalesce(sum(${s.stockMovements.quantity}), 0)::float8` }).from(s.stockMovements).groupBy(s.stockMovements.stockItemId),
  ]);
  const phases = treats.length ? await tx.select().from(s.treatmentPhases).where(inArray(s.treatmentPhases.treatmentId, treats.map((t) => t.id))).orderBy(asc(s.treatmentPhases.order)) : [];
  const sumOf = new Map(sums.map((x) => [x.id, x.total]));
  const out: LinhaEstoque[] = [];
  for (const it of items) {
    const med = meds.find((m) => m.id === it.medicationId);
    const pat = pats.find((p) => p.id === it.patientId);
    const t = treats.find((x) => x.patientId === it.patientId && x.medicationId === it.medicationId);
    if (!med || !pat || !t || t.status !== "active") continue;
    const calc = computeStock({
      balance: sumOf.get(it.id) ?? 0, isEstimate: it.isEstimate, controlUnit: it.controlUnit as ControlUnit, route: med.route, dropsPerMl: med.dropsPerMl,
      treatment: toDomainTreatment(t), phases: phases.filter((p) => p.treatmentId === t.id).map(toDomainPhase),
      thresholdDays: t.lowStockDays ?? defaultLow, now, tz,
    });
    out.push({
      stockItemId: it.id, medicationId: med.id, patientId: pat.id,
      paciente: primeiroNome(pat.name), remedio: med.name, dias: calc.daysLeft, nivel: calc.level, estimativa: it.isEstimate,
      // mesma regra do portal (`quantityText`): comprimido/unidade, ml, g e colírio em gotas (sempre estimativa)
      quantidade: calc.vm.quantityText, quantidadeNumero: calc.vm.quantity, unidade: it.controlUnit as ControlUnit, via: String(med.route),
    });
  }
  return out.sort((a, b) => a.dias - b.dias || a.remedio.localeCompare(b.remedio, "pt-BR"));
}

/** Contagem do dia por paciente (para o resumo diário). */
export async function resumoDoDia(tx: Tx, tz: string, settings: Settings, now: Date) {
  const { date } = localParts(now, tz);
  const ini = zonedToUtc(date, 0, tz);
  const fim = zonedToUtc(addDays(date, 1), 0, tz);
  const rows = await tx
    .select({ d: s.doseEvents, patient: s.patients.name })
    .from(s.doseEvents)
    .innerJoin(s.treatments, eq(s.treatments.id, s.doseEvents.treatmentId))
    .innerJoin(s.patients, eq(s.patients.id, s.doseEvents.patientId))
    .where(and(gte(s.doseEvents.scheduledAt, ini), lt(s.doseEvents.scheduledAt, fim), isNull(s.treatments.deletedAt), isNull(s.patients.deletedAt)));
  const by = new Map<string, { nome: string; tomadas: number; esquecidas: number; pendentes: number; puladas: number }>();
  for (const { d, patient } of rows) {
    const e = by.get(d.patientId) ?? { nome: primeiroNome(patient), tomadas: 0, esquecidas: 0, pendentes: 0, puladas: 0 };
    const st = effectiveStatus(d.status, d.scheduledAt, now, settings);
    if (st === "taken") e.tomadas++;
    else if (st === "missed") e.esquecidas++;
    else if (st === "pending" || st === "late") e.pendentes++;
    else if (st === "skipped") e.puladas++;
    by.set(d.patientId, e);
  }
  return { data: `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`, pacientes: [...by.values()] };
}

export const podeVerEstoque = (a: WaActor) => can(a.member, "stock.view") && can(a.member, "whatsapp.query");
