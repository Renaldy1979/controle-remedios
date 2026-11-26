import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { ativarMembroPorEmail, listarVinculosDaConta, withFamilia, type VinculoDaConta } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { familySettingsSchema, permissionMapSchema, type FamilySettings } from "@medcuidar/shared";
import type { Member } from "@/data/types";
import { DELETION_GRACE_DAYS, PRIVACY_VERSION } from "@/lib/privacy";
import type { AuthAccount } from "../auth/appwrite";
import { currentAccount } from "../auth/session";
import { escolherVinculo, vinculoUtilizavel } from "./family-choice";
import { preferredFamily } from "./family-cookie";

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
  /** Quantas famílias a conta pode usar (mais de uma = o menu oferece "Trocar de família"). */
  familyCount: number;
}

export type Access =
  | { status: "anon" }
  /** logada, mas o e-mail ainda não foi confirmado */
  | { status: "unverified"; account: AuthAccount }
  /** e-mail confirmado, ainda sem família (primeira entrada) */
  | { status: "nofamily"; account: AuthAccount }
  /** todos os vínculos estão desativados (ou as famílias, inativas) */
  | { status: "inactive"; account: AuthAccount }
  /** participa de várias famílias e ainda não escolheu uma */
  | { status: "choose"; account: AuthAccount; families: VinculoDaConta[] }
  /** logada, mas ainda não aceitou a versão vigente da política de privacidade */
  | { status: "privacy"; familyId: string; memberId: string }
  /** a família tem exclusão agendada (30 dias): só o Administrador cancela */
  | { status: "deletion"; familyId: string; memberId: string; timezone: string; member: Member; familyName: string; dueAt: Date }
  | { status: "ok"; ctx: Ctx };

/**
 * Quem está pedindo: valida a sessão NO Appwrite, lista os vínculos da conta (função segura do banco), escolhe a família
 * ativa e relê perfil e permissões do Postgres a cada requisição.
 */
export const getAccess = cache(async (): Promise<Access> => {
  const account = await currentAccount();
  if (!account) return { status: "anon" };
  let memberships = await listarVinculosDaConta(account.id);
  // primeiro acesso por WhatsApp (conta SEM nenhum vínculo): com o e-mail já confirmado, o membro `whatsapp_verified` vira `active`
  if (memberships.length === 0 && account.emailVerified && (await ativarMembroPorEmail(account.email, account.id))) memberships = await listarVinculosDaConta(account.id);
  if (memberships.length === 0) return account.emailVerified ? { status: "nofamily", account } : { status: "unverified", account };
  const usable = memberships.filter(vinculoUtilizavel);
  if (usable.length === 0) return { status: "inactive", account };
  const found = escolherVinculo(usable, await preferredFamily());
  if (!found) return { status: "choose", account, families: usable };

  const row = await withFamilia(found.familiaId, async (tx) => {
    const [r] = await tx
      .select({ member: s.members, profile: s.profiles, family: s.families })
      .from(s.members)
      .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
      .innerJoin(s.families, eq(s.families.id, s.members.familyId))
      .where(eq(s.members.id, found.membroId));
    return r;
  });
  if (!row || !row.member.active || row.member.removedAt || !row.family.active) return { status: "inactive", account };

  const permissions = permissionMapSchema.safeParse(row.profile.permissions);
  const member: Member = {
    id: row.member.id,
    name: row.member.name,
    profileName: row.profile.name,
    permissions: permissions.success ? permissions.data : {},
  };
  // exclusão agendada (Lote 5B): ninguém usa o sistema; o Administrador só vê a tela de cancelar
  if (row.family.deletedAt) {
    return {
      status: "deletion", familyId: row.family.id, memberId: row.member.id, timezone: row.family.timezone, member,
      familyName: row.family.name, dueAt: new Date(row.family.deletedAt.getTime() + DELETION_GRACE_DAYS * 86_400_000),
    };
  }
  // política de privacidade vigente ainda não aceita (Lote 5B)
  if (row.member.privacyVersion !== PRIVACY_VERSION) return { status: "privacy", familyId: row.family.id, memberId: row.member.id };
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
      member,
      familyCount: usable.length,
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
    case "choose":
      return redirect("/escolher-familia");
    case "unverified":
      return redirect("/verificar-email");
    case "nofamily":
      return redirect("/criar-familia");
    case "privacy":
      return redirect("/privacidade/aceitar");
    case "deletion":
      return redirect("/exclusao-agendada");
    case "ok":
      return a.ctx;
  }
}

export { requirePermission } from "./guard";
