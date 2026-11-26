import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { listarVinculosDaConta, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import { audit } from "./audit";

export interface NewAdmin {
  appwriteUserId: string;
  name: string;
  email: string;
  familyName: string;
}

/** Janela em que repetir "criar a família X" é tratado como clique duplo. */
const DOUBLE_CLICK_MS = 2 * 60_000;

/**
 * Cria a família, os perfis iniciais e o administrador (`access_state = active`).
 * O banco exige `appwrite_user_id` + e-mail confirmado no estado ativo, então só chame depois de o Appwrite
 * confirmar o e-mail. Tudo numa transação: ou cria tudo ou nada.
 * A mesma conta pode criar quantas famílias quiser (docs/15); só o envio repetido (mesmo nome em 2 min) devolve a já criada.
 */
export async function createFamilyWithAdmin(input: NewAdmin): Promise<{ familyId: string; memberId: string }> {
  const familyId = randomUUID();
  const memberId = randomUUID();
  const adminProfileId = randomUUID();
  return withFamilia(familyId, async (tx) => {
    // uma criação por conta de cada vez: o segundo clique espera o primeiro terminar e o encontra
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`create_family:${input.appwriteUserId}`}, 0))`);
    const wanted = input.familyName.trim().toLowerCase();
    const repeated = (await listarVinculosDaConta(input.appwriteUserId)).find(
      (v) => v.perfilNome === "Administrador" && v.familiaNome.trim().toLowerCase() === wanted && Date.now() - v.criadoEm.getTime() < DOUBLE_CLICK_MS,
    );
    if (repeated) return { familyId: repeated.familiaId, memberId: repeated.membroId };
    await tx.insert(s.families).values({ id: familyId, name: input.familyName, settings: familySettingsSchema.parse({}) });
    await tx.insert(s.profiles).values(
      SYSTEM_PROFILES.map((p) => ({
        id: p.name === "Administrador" ? adminProfileId : randomUUID(),
        familyId,
        name: p.name,
        permissions: p.permissions as Record<string, boolean>,
        isSystem: true,
      })),
    );
    await tx.insert(s.members).values({
      id: memberId,
      familyId,
      profileId: adminProfileId,
      name: input.name,
      email: input.email.toLowerCase(),
      accessState: "active",
      appwriteUserId: input.appwriteUserId,
      emailConfirmedAt: new Date(),
      roleLabel: "administrador(a)",
    });
    await audit(tx, { familyId, memberId }, "family.create", "family", familyId, { profiles: SYSTEM_PROFILES.length });
    return { familyId, memberId };
  });
}
