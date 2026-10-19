import { sql } from "drizzle-orm";
import { getDb, type Db, type Tx } from "./client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Abre uma transação com a família definida para o RLS (`app.familia_id`, local à transação).
 * Todo acesso a dados de negócio passa por aqui. Se `fn` lançar, tudo é revertido.
 */
export async function withFamilia<T>(
  familiaId: string,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  if (!UUID_RE.test(familiaId)) throw new Error("familiaId inválido");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.familia_id', ${familiaId}, true)`);
    return fn(tx);
  });
}

/**
 * Transação da PLATAFORMA (`app.plataforma = 'on'`): libera só as tabelas sem família
 * (platform_api_keys, platform_audit_log). Nenhuma tabela de família fica visível aqui.
 */
export async function withPlataforma<T>(fn: (tx: Tx) => Promise<T>, db: Db = getDb()): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.plataforma', 'on', true)`);
    return fn(tx);
  });
}
