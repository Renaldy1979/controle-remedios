import "server-only";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { PERMISSION_GROUPS, isActionGroup, isReadOnlyProfile, permissionMapSchema } from "@medcuidar/shared";
import { audit } from "./audit";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";

/** Liga/desliga uma funcionalidade (grupo de permissões) de um perfil. O Administrador sempre pode tudo. */
export async function setPermission(actor: Actor, rowId: string, profileName: string, value: boolean): Promise<void> {
  requirePermission(actor, "profiles.manage");
  const group = PERMISSION_GROUPS.find((g) => g.id === rowId && g.keys.length > 0);
  if (!group) throw new UserError("Funcionalidade desconhecida.");
  if (profileName === "Administrador") throw new UserError("O Administrador sempre pode tudo.");
  // perfil de quem só acompanha: permissões de ação nunca ligam (desligar é inofensivo e segue permitido)
  if (isReadOnlyProfile(profileName) && value && isActionGroup(group)) {
    throw new UserError("O perfil Somente leitura não pode ter permissões de ação. Para quem precisa agir, use outro perfil.");
  }
  await withFamilia(actor.familyId, async (tx) => {
    const [profile] = await tx.select().from(s.profiles).where(eq(s.profiles.name, profileName));
    if (!profile) throw new UserError("Perfil não encontrado.");
    const current = permissionMapSchema.safeParse(profile.permissions);
    const next: Record<string, boolean> = { ...(current.success ? current.data : {}) };
    for (const k of group.keys) next[k] = value;
    await tx.update(s.profiles).set({ permissions: next }).where(eq(s.profiles.id, profile.id));
    await audit(tx, actor, "profile.permission", "profile", profile.id, { group: group.id, value });
  });
}
