import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { FamilyScopedDb } from "@medcuidar/db";
import { can, familySettingsSchema, parseJsonField, permissionMapSchema, type FamilySettings, type PermissionKey } from "@medcuidar/shared";
import type { Member } from "@/data/types";
import { clients, familyDb } from "./clients";
import { FAMILY_COOKIE, SESSION_COOKIE } from "./cookies";
import { membershipsOf, pickFamily, userOfSession, type Membership } from "./session";

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Sem permissão: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export interface Ctx {
  /** Sempre vem do cadastro de membro da pessoa logada, nunca de parâmetro do cliente. */
  familyId: string;
  familyName: string;
  /** a pessoa pertence a mais de uma família (pode trocar) */
  canSwitchFamily: boolean;
  /** usuário do Appwrite Auth dono da sessão */
  userId: string;
  member: Member;
  db: FamilyScopedDb;
  timezone: string;
  settings: FamilySettings;
}

export type Access =
  | { status: "anon" }
  | { status: "choose"; userId: string; memberships: Membership[] }
  | { status: "ok"; ctx: Ctx };

/**
 * Quem está pedindo: valida a sessão NO Appwrite, acha os cadastros de membro por `user_id` (precisam estar
 * ativos), escolhe a família e relê perfil e permissões no banco a cada requisição.
 */
export const getAccess = cache(async (): Promise<Access> => {
  const jar = await cookies();
  const userId = await userOfSession(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return { status: "anon" };
  const memberships = await membershipsOf(userId);
  const pick = pickFamily(memberships, jar.get(FAMILY_COOKIE)?.value);
  if (pick === null) return { status: "anon" };
  if (pick === "choose") return { status: "choose", userId, memberships };
  const db = familyDb(pick.familyId);
  try {
    const m = await db.get("members", pick.memberId);
    if (m["active"] !== true) return { status: "anon" };
    const profile = await db.get("profiles", String(m["profile_id"]));
    const permissions = parseJsonField(permissionMapSchema, String(profile["permissions"] ?? "{}"));
    const fam = await clients().databases.getDocument(clients().databaseId, "families", pick.familyId);
    return {
      status: "ok",
      ctx: {
        familyId: pick.familyId,
        familyName: pick.familyName,
        canSwitchFamily: memberships.length > 1,
        userId,
        db,
        member: { id: m.$id, name: String(m["name"]), profileName: String(profile["name"]), permissions },
        timezone: String(fam["timezone"] ?? "America/Sao_Paulo"),
        settings: parseJsonField(familySettingsSchema, String(fam["settings"] ?? "{}")),
      },
    };
  } catch {
    return { status: "anon" };
  }
});

export async function getContext(): Promise<Ctx | null> {
  const a = await getAccess();
  return a.status === "ok" ? a.ctx : null;
}

export async function requireContext(): Promise<Ctx> {
  const a = await getAccess();
  if (a.status === "anon") redirect("/login");
  if (a.status === "choose") redirect("/familia");
  return a.ctx;
}

/** Recusa no SERVIDOR (não só esconde na UI). */
export function requirePermission(ctx: Ctx, ...permissions: PermissionKey[]): void {
  for (const p of permissions) if (!can(ctx.member, p)) throw new ForbiddenError(p);
}
