import { sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "./client";
import { auditarPlataforma } from "./plataforma";
import * as s from "./schema";
import { withFamilia } from "./withFamilia";

/**
 * Exclusão definitiva de uma família (Lote 5B, docs/13). Filhos antes dos pais; `audit_log` aponta para membros e vai primeiro.
 * Qualquer tabela nova com `family_id` que ainda não esteja nesta lista é apagada ANTES dos membros (nunca sobra linha órfã);
 * o teste de exclusão confere, tabela por tabela, que nada da família ficou.
 */
export const ORDEM_EXCLUSAO = [
  "audit_log", "family_integrations", "ai_usage", "agent_sessions", "outbound_messages", "conversation_state", "api_keys", "message_log", "notifications",
  "replenishment_steps", "stock_movements", "replenishments", "prescription_views",
  "prescription_shares", "prescription_items", "prescription_files", "prescriptions", "dose_events", "stock_items",
  "treatment_phases", "treatments", "care_assignments", "patients", "medications", "first_access_links", "invites",
  "members", "profiles",
  "idempotency", "families",
] as const;

export type DadosExternos = { arquivos: string[]; usuariosAppwrite: string[] };

/** O que a família tem FORA do Postgres: arquivos de receita (bucket do Appwrite) e contas de login. Lido antes de apagar. */
export async function dadosExternosDaFamilia(familiaId: string, db: Db = getDb()): Promise<DadosExternos> {
  return withFamilia(familiaId, async (tx) => {
    const arquivos = await tx.select({ id: s.prescriptionFiles.storageFileId }).from(s.prescriptionFiles);
    const usuarios = await tx.select({ id: s.members.appwriteUserId }).from(s.members);
    return {
      arquivos: [...new Set(arquivos.map((a) => a.id))],
      usuariosAppwrite: [...new Set(usuarios.map((u) => u.id).filter((x): x is string => !!x))],
    };
  }, db);
}

async function apagarTudo(tx: Tx, familiaId: string): Promise<Record<string, number>> {
  const comFamilia = (await tx.execute<{ table_name: string }>(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'family_id'`)).map((r) => r.table_name);
  const extras = comFamilia.filter((t) => !(ORDEM_EXCLUSAO as readonly string[]).includes(t) && t !== "platform_audit_log");
  const iMembros = ORDEM_EXCLUSAO.indexOf("members");
  const ordem = [...ORDEM_EXCLUSAO.slice(0, iMembros), ...extras, ...ORDEM_EXCLUSAO.slice(iMembros)];
  const contagens: Record<string, number> = {};
  for (const t of ordem) {
    const coluna = t === "families" ? "id" : "family_id";
    const r = await tx.execute(sql.raw(`delete from "${t}" where "${coluna}" = '${familiaId}'::uuid`));
    contagens[t] = r.count ?? 0;
  }
  return contagens;
}

/**
 * Apaga TODAS as linhas da família numa transação (ou apaga tudo ou nada) e deixa um registro SEM dado pessoal na auditoria da
 * plataforma (id da família, data). Só chame depois de apagar os arquivos e contas externas (ver `dadosExternosDaFamilia`).
 */
export async function excluirFamiliaDefinitivo(familiaId: string, db: Db = getDb()): Promise<{ tabelas: Record<string, number> }> {
  const tabelas = await withFamilia(familiaId, (tx) => apagarTudo(tx, familiaId), db);
  await auditarPlataforma({ chaveId: null, metodo: "JOB", rota: "family.purge", familiaId, telefone: null, status: 200 }, db);
  return { tabelas };
}
