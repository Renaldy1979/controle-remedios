import "server-only";
import { randomUUID } from "node:crypto";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import { audit } from "./audit";
import { UserError, isUniqueViolation } from "./errors";

export interface NewAdmin {
  appwriteUserId: string;
  name: string;
  email: string;
  familyName: string;
}

/**
 * Primeira entrada: cria a família, os perfis iniciais e o administrador (`access_state = active`).
 * O banco exige `appwrite_user_id` + e-mail confirmado no estado ativo, então só chame depois de o Appwrite
 * confirmar o e-mail. Tudo numa transação: ou cria tudo ou nada.
 */
export async function createFamilyWithAdmin(input: NewAdmin): Promise<{ familyId: string; memberId: string }> {
  const familyId = randomUUID();
  const memberId = randomUUID();
  const adminProfileId = randomUUID();
  try {
    await withFamilia(familyId, async (tx) => {
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
    });
  } catch (e) {
    // clique duplo: a mesma conta do Appwrite já virou membro (índice único em appwrite_user_id)
    if (isUniqueViolation(e)) throw new UserError("Esta conta já tem uma família.");
    throw e;
  }
  return { familyId, memberId };
}
