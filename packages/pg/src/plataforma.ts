import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { gerarApiKey } from "./crypto";
import * as s from "./schema";
import { withPlataforma } from "./withFamilia";

/** Chaves `cpl_` (plataforma, ex.: N8N) e a auditoria das chamadas. Só dentro de withPlataforma (RLS `app.plataforma`). */

export type ChavePlataforma = { id: string; nome: string; escopos: string[]; ultimoUso: Date | null; revogadaEm: Date | null; criadaEm: Date };

export async function criarChavePlataforma(nome: string, escopos: string[] = ["conversa"], db: Db = getDb()): Promise<{ id: string; chave: string }> {
  const k = gerarApiKey("plataforma");
  const id = await withPlataforma(async (tx) => {
    const [r] = await tx.insert(s.platformApiKeys).values({ name: nome, keyHash: k.hash, scopes: escopos }).returning({ id: s.platformApiKeys.id });
    return r!.id;
  }, db);
  return { id, chave: k.chave };
}

export async function listarChavesPlataforma(db: Db = getDb()): Promise<ChavePlataforma[]> {
  const rows = await withPlataforma((tx) => tx.select().from(s.platformApiKeys).orderBy(desc(s.platformApiKeys.createdAt)), db);
  return rows.map((r) => ({ id: r.id, nome: r.name, escopos: r.scopes, ultimoUso: r.lastUsedAt, revogadaEm: r.revokedAt, criadaEm: r.createdAt }));
}

export async function revogarChavePlataforma(id: string, db: Db = getDb()): Promise<boolean> {
  const rows = await withPlataforma(
    (tx) => tx.update(s.platformApiKeys).set({ revokedAt: new Date() }).where(and(eq(s.platformApiKeys.id, id), isNull(s.platformApiKeys.revokedAt))).returning({ id: s.platformApiKeys.id }),
    db,
  );
  return rows.length > 0;
}

/** Telefone mascarado para a auditoria: só os 4 últimos dígitos. */
export const mascararTelefone = (t: string | null | undefined): string | null => {
  const d = String(t ?? "").replace(/\D/g, "");
  return d ? `…${d.slice(-4)}` : null;
};

export async function auditarPlataforma(
  e: { chaveId: string | null; metodo: string; rota: string; familiaId: string | null; telefone: string | null; status: number },
  db: Db = getDb(),
): Promise<void> {
  await withPlataforma(async (tx) => {
    await tx.insert(s.platformAuditLog).values({
      keyId: e.chaveId, method: e.metodo, route: e.rota, familyId: e.familiaId, maskedPhone: mascararTelefone(e.telefone), status: e.status,
    });
  }, db);
}
