/**
 * Apoio dos testes de integração: conecta nos dois papéis, aplica as migrações e cria/limpa famílias descartáveis.
 * Não é exportado pelo index (não entra no bundle da aplicação).
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { adminUrl, appUrl } from "./env";
import { runMigrations } from "./migrate";
import { closeDb, getDb } from "./client";
import { withFamilia } from "./withFamilia";
import * as s from "./schema";

export type Admin = ReturnType<typeof postgres>;

/** Conexão do papel dono (BYPASSRLS), só para preparar/conferir dados nos testes. */
export function conectarAdmin(): Admin {
  return postgres(adminUrl(), { max: 2, onnotice: () => {} });
}

/** O Postgres local responde? (para pular a integração com uma mensagem clara) */
export async function bancoDisponivel(): Promise<boolean> {
  const sql = postgres(adminUrl(), { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function prepararBanco(): Promise<void> {
  await runMigrations();
  getDb(appUrl());
}

export async function encerrar(admin?: Admin): Promise<void> {
  await closeDb();
  await admin?.end({ timeout: 2 });
}

/** Telefone fictício aleatório (só dígitos) para não colidir com o seed nem com outras execuções. */
export const telefoneAleatorio = (): string => "5599" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");

/** Filhos antes dos pais, para limpar por família. */
const ORDEM_LIMPEZA = [
  "family_integrations", "outbound_messages", "conversation_state", "api_keys", "message_log", "notifications", "replenishment_steps", "stock_movements", "replenishments", "prescription_views",
  "prescription_shares", "prescription_items", "prescription_files", "prescriptions", "dose_events", "stock_items",
  "treatment_phases", "treatments", "care_assignments", "patients", "medications", "first_access_links", "invites",
  "members", "profiles",
  "idempotency", "audit_log", "families",
];

export async function limparFamilias(admin: Admin, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const t of ORDEM_LIMPEZA) {
    const coluna = t === "families" ? "id" : "family_id";
    await admin.unsafe(`delete from ${t} where ${coluna} = any($1::uuid[])`, [ids]);
  }
}

export type FamiliaTeste = {
  id: string; profileId: string; memberId: string; patientId: string; medicationId: string; treatmentId: string;
  stockItemId: string; doseId: string;
};

/** Cria uma família completa (com um de cada coisa) pelo papel da APLICAÇÃO, via withFamilia. */
export async function criarFamiliaTeste(nome: string): Promise<FamiliaTeste> {
  const f: FamiliaTeste = {
    id: randomUUID(), profileId: randomUUID(), memberId: randomUUID(), patientId: randomUUID(),
    medicationId: randomUUID(), treatmentId: randomUUID(), stockItemId: randomUUID(), doseId: randomUUID(),
  };
  await withFamilia(f.id, async (tx) => {
    await tx.insert(s.families).values({ id: f.id, name: nome });
    await tx.insert(s.profiles).values({ id: f.profileId, familyId: f.id, name: "Administrador", isSystem: true });
    await tx.insert(s.members).values({ id: f.memberId, familyId: f.id, profileId: f.profileId, name: `Membro ${nome}` });
    await tx.insert(s.patients).values({ id: f.patientId, familyId: f.id, name: `Paciente ${nome}` });
    await tx.insert(s.medications).values({ id: f.medicationId, familyId: f.id, name: "Remédio", route: "tablet", controlUnit: "unit" });
    await tx.insert(s.treatments).values({
      id: f.treatmentId, familyId: f.id, patientId: f.patientId, medicationId: f.medicationId, startDate: "2026-10-01",
    });
    await tx.insert(s.stockItems).values({
      id: f.stockItemId, familyId: f.id, patientId: f.patientId, medicationId: f.medicationId, controlUnit: "unit",
    });
    await tx.insert(s.doseEvents).values({
      id: f.doseId, familyId: f.id, treatmentId: f.treatmentId, patientId: f.patientId, medicationId: f.medicationId,
      scheduledAt: new Date("2026-10-19T11:00:00Z"), amount: 1,
    });
  });
  return f;
}
