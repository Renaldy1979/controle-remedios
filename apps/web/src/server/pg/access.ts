import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { ativarMembroPorEmail, resolverMembroPorAppwriteUser, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { familySettingsSchema, permissionMapSchema, type FamilySettings } from "@medcuidar/shared";
import type { Member } from "@/data/types";
import type { AuthAccount } from "../auth/appwrite";
import { currentAccount } from "../auth/session";

export interface Ctx {
  /** Sempre vem do cadastro de membro da pessoa logada (resolve_member_by_appwrite_user), nunca do cliente. */
  familyId: string;
  familyName: string;
  timezone: string;
  settings: FamilySettings;
  account: AuthAccount;
  memberId: string;
  profileId: string;
  member: Member;
}

export type Access =
  | { status: "anon" }
  /** logada, mas o e-mail ainda não foi confirmado */
  | { status: "unverified"; account: AuthAccount }
  /** e-mail confirmado, ainda sem família (primeira entrada) */
  | { status: "nofamily"; account: AuthAccount }
  /** desativada, ou família inativa */
  | { status: "inactive" }
  | { status: "ok"; ctx: Ctx };

/**
 * Quem está pedindo: valida a sessão NO Appwrite, acha o membro pelo id do usuário do Appwrite
 * (função segura do banco) e relê perfil e permissões do Postgres a cada requisição.
 */
export const getAccess = cache(async (): Promise<Access> => {
  const account = await currentAccount();
  if (!account) return { status: "anon" };
  let found = await resolverMembroPorAppwriteUser(account.id);
  // primeiro acesso por WhatsApp: com o e-mail já confirmado no Appwrite, o membro `whatsapp_verified` vira `active`
  if (!found && account.emailVerified && (await ativarMembroPorEmail(account.email, account.id))) found = await resolverMembroPorAppwriteUser(account.id);
  if (!found) return account.emailVerified ? { status: "nofamily", account } : { status: "unverified", account };
  if (!found.ativo || found.estadoAcesso !== "active") return { status: "inactive" };

  const row = await withFamilia(found.familiaId, async (tx) => {
    const [r] = await tx
      .select({ member: s.members, profile: s.profiles, family: s.families })
      .from(s.members)
      .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
      .innerJoin(s.families, eq(s.families.id, s.members.familyId))
      .where(eq(s.members.id, found.membroId));
    return r;
  });
  if (!row || !row.member.active || row.member.removedAt || !row.family.active || row.family.deletedAt) return { status: "inactive" };

  const permissions = permissionMapSchema.safeParse(row.profile.permissions);
  return {
    status: "ok",
    ctx: {
      familyId: row.family.id,
      familyName: row.family.name,
      timezone: row.family.timezone,
      settings: familySettingsSchema.parse(row.family.settings ?? {}),
      account,
      memberId: row.member.id,
      profileId: row.profile.id,
      member: {
        id: row.member.id,
        name: row.member.name,
        profileName: row.profile.name,
        permissions: permissions.success ? permissions.data : {},
      },
    },
  };
});

export async function getContext(): Promise<Ctx | null> {
  const a = await getAccess();
  return a.status === "ok" ? a.ctx : null;
}

/** Para páginas protegidas: manda cada situação para o lugar certo. */
export async function requireContext(): Promise<Ctx> {
  const a = await getAccess();
  switch (a.status) {
    case "anon":
      return redirect("/login");
    case "inactive":
      return redirect("/login?erro=inativo");
    case "unverified":
      return redirect("/verificar-email");
    case "nofamily":
      return redirect("/criar-familia");
    case "ok":
      return a.ctx;
  }
}

export { requirePermission } from "./guard";
