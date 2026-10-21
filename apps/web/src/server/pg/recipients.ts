import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { can, permissionMapSchema, type PermissionKey, type PermissionMap } from "@medcuidar/shared";

/** Usuários ATIVOS da família (e-mail confirmado, acesso `active`) cujo perfil satisfaz `test`. Quem só tem WhatsApp verificado não entra. */
export async function membersMatching(
  tx: Tx,
  test: (m: { profileName: string; permissions: PermissionMap }) => boolean,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await tx
    .select({ id: s.members.id, name: s.members.name, profileName: s.profiles.name, permissions: s.profiles.permissions })
    .from(s.members)
    .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
    .where(and(eq(s.members.active, true), isNull(s.members.removedAt), eq(s.members.accessState, "active")));
  return rows
    .filter((r) => {
      const p = permissionMapSchema.safeParse(r.permissions);
      return test({ profileName: r.profileName, permissions: p.success ? p.data : {} });
    })
    .map((r) => ({ id: r.id, name: r.name }));
}

export const membersWithPermission = (tx: Tx, ...keys: PermissionKey[]) =>
  membersMatching(tx, (m) => keys.every((k) => can(m, k)));
