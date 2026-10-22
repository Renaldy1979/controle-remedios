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

/**
 * O Postgres local responde? Com carga alta (várias suítes em paralelo) uma conexão pode demorar: 3 tentativas de 10 s.
 * Se NÃO responder, a suíte é PULADA, mas com um aviso bem visível (um verde por pulo é falso verde). Com `REQUIRE_DB=1`
 * (CI e conferência) a falta do banco FALHA a suíte em vez de pular.
 */
export async function bancoDisponivel(): Promise<boolean> {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const sql = postgres(adminUrl(), { max: 1, connect_timeout: 10, onnotice: () => {} });
    try {
      await sql`select 1`;
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }
  const msg = "Postgres local INDISPONÍVEL: testes de integração PULADOS (isto NÃO é um verde de verdade). Rode `pnpm db:up`. Com REQUIRE_DB=1 isto falha.";
  if (process.env["REQUIRE_DB"] === "1") throw new Error(msg);
  console.error(`\n${"!".repeat(100)}\n!!! ${msg}\n${"!".repeat(100)}\n`);
  return false;
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

/** Filhos antes dos pais, para limpar por família. `audit_log` aponta para membros: vai primeiro. */
const ORDEM_LIMPEZA = [
  "audit_log", "family_integrations", "ai_usage", "agent_sessions", "outbound_messages", "conversation_state", "api_keys", "message_log", "notifications",
  "replenishment_steps", "stock_movements", "replenishments", "prescription_views",
  "prescription_shares", "prescription_items", "prescription_files", "prescriptions", "dose_events", "stock_items",
  "treatment_phases", "treatments", "care_assignments", "patients", "medications", "first_access_links", "invites",
  "members", "profiles",
  "idempotency", "families",
];

async function apagarFamilias(admin: Admin, ids: string[]): Promise<void> {
  // tabelas com family_id que ainda não estão na ordem (tabela nova nunca deixa linha órfã): antes dos membros
  const todas = (await admin`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'family_id'`).map((r) => r["table_name"] as string);
  const extras = todas.filter((t) => !ORDEM_LIMPEZA.includes(t) && t !== "platform_audit_log");
  const ordem = [...ORDEM_LIMPEZA.slice(0, ORDEM_LIMPEZA.indexOf("members")), ...extras, ...ORDEM_LIMPEZA.slice(ORDEM_LIMPEZA.indexOf("members"))];
  for (const t of ordem) {
    const coluna = t === "families" ? "id" : "family_id";
    await admin.unsafe(`delete from ${t} where ${coluna} = any($1::uuid[])`, [ids]);
  }
}

/**
 * Apaga as famílias de teste e TUDO delas. Outra suíte (ou o worker) pode abrir uma reposição ou aviso no meio da limpeza
 * (a rotina de lembretes percorre todas as famílias): por isso tenta de novo. Depois CONFERE que sumiram e lança se sobrou alguma:
 * teste que vaza família falha, não passa em silêncio.
 */
export async function limparFamilias(admin: Admin, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  let ultimo: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      await apagarFamilias(admin, ids);
      ultimo = undefined;
      break;
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  const [sobra] = await admin`select count(*)::int as n from families where id = any(${ids}::uuid[])`;
  if (ultimo || (sobra?.["n"] as number) > 0) {
    throw new Error(`Limpeza dos testes falhou: sobraram ${sobra?.["n"] ?? "?"} família(s) de teste${ultimo instanceof Error ? ` (${ultimo.message})` : ""}.`);
  }
}

/**
 * Faxina de famílias de teste esquecidas por execuções que caíram (membro com e-mail `zz-test-…` ou nomes do apoio, criadas há mais de
 * 30 minutos, para nunca apagar o que outra suíte em andamento está usando). Nunca toca a família demo.
 */
export async function limparFamiliasAntigasDeTeste(admin: Admin): Promise<number> {
  const rows = await admin`
    select f.id from families f
    where f.created_at < now() - interval '30 minutes' and f.name <> 'Família Souza (demo)'
      and exists (select 1 from members m where m.family_id = f.id and m.email like 'zz-test-%')`;
  const ids = rows.map((r) => r["id"] as string);
  if (ids.length) await limparFamilias(admin, ids).catch(() => {});
  return ids.length;
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
