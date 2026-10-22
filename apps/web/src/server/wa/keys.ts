import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { gerarApiKey, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { audit } from "../pg/audit";
import { UserError } from "../pg/errors";
import { isAdmin, type Actor } from "../pg/guard";

export interface ChaveVM {
  id: string;
  nome: string;
  prefixo: string;
  criadaEm: Date;
  ultimoUso: Date | null;
  revogadaEm: Date | null;
}

function soAdmin(actor: Pick<Actor, "member">) {
  if (!isAdmin(actor)) throw new UserError("Só um Administrador cuida das chaves de API.");
}

/** Chaves `cdf_` da família. O banco só tem o hash: aqui nunca aparece o valor. */
export async function listarChavesFamilia(actor: Actor): Promise<ChaveVM[]> {
  soAdmin(actor);
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx.select().from(s.apiKeys).orderBy(desc(s.apiKeys.createdAt));
    return rows.map((r) => ({ id: r.id, nome: r.name, prefixo: r.prefix, criadaEm: r.createdAt, ultimoUso: r.lastUsedAt, revogadaEm: r.revokedAt }));
  });
}

/** Cria a chave e devolve o valor UMA vez. */
export async function criarChaveFamilia(actor: Actor, nome: string): Promise<{ id: string; chave: string }> {
  soAdmin(actor);
  const name = nome.trim();
  if (name.length < 2 || name.length > 60) throw new UserError("Dê um nome à chave (2 a 60 letras).");
  const k = gerarApiKey("familia");
  const id = await withFamilia(actor.familyId, async (tx) => {
    const [r] = await tx
      .insert(s.apiKeys)
      .values({ familyId: actor.familyId, name, prefix: "cdf_", keyHash: k.hash, scopes: ["api"], createdByMemberId: actor.memberId })
      .returning({ id: s.apiKeys.id });
    await audit(tx, actor, "api_key.create", "api_key", r!.id, { kind: "familia" });
    return r!.id;
  });
  return { id, chave: k.chave };
}

export async function revogarChaveFamilia(actor: Actor, id: string): Promise<void> {
  soAdmin(actor);
  await withFamilia(actor.familyId, async (tx) => {
    const rows = await tx.update(s.apiKeys).set({ revokedAt: new Date() }).where(and(eq(s.apiKeys.id, id), isNull(s.apiKeys.revokedAt))).returning({ id: s.apiKeys.id });
    if (rows.length === 0) throw new UserError("Chave não encontrada ou já revogada.");
    await audit(tx, actor, "api_key.revoke", "api_key", id, { kind: "familia" });
  });
}
