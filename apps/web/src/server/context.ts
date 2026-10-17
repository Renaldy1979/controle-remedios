import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { FamilyScopedDb } from "@medcuidar/db";
import { can, familySettingsSchema, parseJsonField, permissionMapSchema, type FamilySettings, type PermissionKey } from "@medcuidar/shared";
import type { Member } from "@/data/types";
import { clients, familyDb } from "./clients";
import { sessionSecret } from "./env";
import { SESSION_COOKIE, verifySession } from "./session-token";

export class ForbiddenError extends Error {
  constructor(permission: string) {
    super(`Sem permissão: ${permission}`);
    this.name = "ForbiddenError";
  }
}

export interface Ctx {
  /** Sempre vem da sessão assinada, nunca de parâmetro do cliente. */
  familyId: string;
  member: Member;
  db: FamilyScopedDb;
  timezone: string;
  settings: FamilySettings;
}

/** Contexto da requisição: valida o cookie, confere se a pessoa segue ativa e carrega perfil e permissões. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  const claims = await verifySession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!claims) return null;
  const db = familyDb(claims.f);
  try {
    const m = await db.get("members", claims.m);
    if (m["active"] !== true) return null;
    const profile = await db.get("profiles", String(m["profile_id"]));
    const permissions = parseJsonField(permissionMapSchema, String(profile["permissions"] ?? "{}"));
    const fam = await clients().databases.getDocument(clients().databaseId, "families", claims.f);
    if (fam["deleted_at"]) return null;
    return {
      familyId: claims.f,
      db,
      member: { id: m.$id, name: String(m["name"]), profileName: String(profile["name"]), permissions },
      timezone: String(fam["timezone"] ?? "America/Sao_Paulo"),
      settings: parseJsonField(familySettingsSchema, String(fam["settings"] ?? "{}")),
    };
  } catch {
    return null;
  }
});

export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Recusa no SERVIDOR (não só esconde na UI). */
export function requirePermission(ctx: Ctx, ...permissions: PermissionKey[]): void {
  for (const p of permissions) if (!can(ctx.member, p)) throw new ForbiddenError(p);
}
