import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  VALIDADE_CONVITE_MS, gerarCodigoVerificacao, gerarTokenPrimeiroAcesso, hashConviteCodigo, withFamilia,
} from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { normalizePhone } from "@/lib/phone";
import { audit } from "./audit";
import { UserError, isUniqueViolation, pgCode } from "./errors";
import { isAdmin, requirePermission, type Actor } from "./guard";
import { stampLabel } from "./stamp";

/** O que o servidor precisa do Appwrite. Injetado para que as regras possam ser testadas sem rede. */
export interface AuthPort {
  sendInviteEmail(email: string, url: string): Promise<void>;
  revokeSessions(appwriteUserId: string): Promise<void>;
  setEnabled(appwriteUserId: string, enabled: boolean): Promise<void>;
}
export interface Deps {
  auth: AuthPort;
  /** URL pública do portal, sem barra no fim */
  baseUrl: string;
}

export interface InviteOutcome {
  kind: "email" | "whatsapp";
  memberId: string;
  memberName: string;
  emailSent?: boolean;
  /** Mostrado UMA vez; só o hash fica no banco. */
  code?: string;
  expectedPhone?: string;
  expiresLabel: string;
}

export interface InviteInput {
  kind: "email" | "whatsapp";
  name: string;
  email?: string;
  phone?: string;
  profileName: string;
  relation?: string;
}

const ADMIN = "Administrador";
type Tx = Parameters<Parameters<typeof withFamilia>[1]>[0];

async function profileByName(tx: Tx, name: string) {
  const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, name));
  if (!p) throw new UserError("Perfil não encontrado.");
  return p;
}

function assertMayGive(actor: Actor, profileName: string) {
  if (profileName === ADMIN && !isAdmin(actor)) throw new UserError("Só um Administrador pode dar o perfil Administrador.");
}

async function otherActiveAdmins(tx: Tx, exceptMemberId: string): Promise<number> {
  const rows = await tx
    .select({ id: s.members.id })
    .from(s.members)
    .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
    .where(and(eq(s.profiles.name, ADMIN), eq(s.members.active, true), eq(s.members.accessState, "active"), sql`${s.members.id} <> ${exceptMemberId}`));
  return rows.length;
}

const loadMember = async (tx: Tx, id: string) => {
  const [m] = await tx
    .select({ m: s.members, profileName: s.profiles.name })
    .from(s.members)
    .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
    .where(eq(s.members.id, id));
  if (!m) throw new UserError("Pessoa não encontrada.");
  return m;
};

/** Convite por e-mail: a pessoa valida o e-mail e define a senha (Magic URL do Appwrite) e entra com o perfil escolhido. */
export async function inviteByEmail(actor: Actor, input: InviteInput, deps: Deps): Promise<InviteOutcome> {
  requirePermission(actor, "members.manage");
  assertMayGive(actor, input.profileName);
  const email = String(input.email ?? "").trim().toLowerCase();
  const expiresAt = new Date(Date.now() + VALIDADE_CONVITE_MS);
  const link = gerarTokenPrimeiroAcesso();

  let created: { memberId: string };
  try {
    created = await withFamilia(actor.familyId, async (tx) => {
      const profile = await profileByName(tx, input.profileName);
      const [member] = await tx
        .insert(s.members)
        .values({ familyId: actor.familyId, profileId: profile.id, name: input.name, email, roleLabel: input.relation?.trim() || null })
        .returning({ id: s.members.id });
      await tx.insert(s.invites).values({
        familyId: actor.familyId, kind: "email", profileId: profile.id, memberId: member!.id, email, expiresAt, createdByMemberId: actor.memberId,
      });
      await tx.insert(s.firstAccessLinks).values({ familyId: actor.familyId, memberId: member!.id, tokenHash: link.hash, expiresAt });
      await audit(tx, actor, "member.invite", "member", member!.id, { kind: "email", profile: input.profileName });
      return { memberId: member!.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new UserError("Já existe uma pessoa com esse e-mail nesta família.");
    throw e;
  }

  const emailSent = await trySend(deps, email, link.token);
  return { kind: "email", memberId: created.memberId, memberName: input.name, emailSent, expiresLabel: stampLabel(expiresAt, actor.timezone) };
}

async function trySend(deps: Deps, email: string, token: string): Promise<boolean> {
  try {
    await deps.auth.sendInviteEmail(email, `${deps.baseUrl}/aceitar-convite?t=${token}`);
    return true;
  } catch (e) {
    console.error("[convite] e-mail não enviado", (e as { code?: number }).code ?? (e as Error).name);
    return false;
  }
}

/**
 * Convite por WhatsApp (Lote 1: só a CRIAÇÃO). Guarda o hash do código preso ao número esperado, validade de 24 h,
 * e devolve o código UMA vez. O uso do código (o convidado enviar ao WhatsApp do sistema) chega no Lote 4.
 */
export async function inviteByWhatsapp(actor: Actor, input: InviteInput): Promise<InviteOutcome> {
  requirePermission(actor, "members.manage");
  assertMayGive(actor, input.profileName);
  const phone = normalizePhone(input.phone ?? "");
  if (!phone) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
  const code = gerarCodigoVerificacao();
  const expiresAt = new Date(Date.now() + VALIDADE_CONVITE_MS);

  try {
    const memberId = await withFamilia(actor.familyId, async (tx) => {
      const active = await tx
        .select({ id: s.invites.id })
        .from(s.invites)
        .where(and(eq(s.invites.kind, "whatsapp"), eq(s.invites.expectedPhone, phone), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
      if (active.length) throw new UserError("Já existe um convite em andamento para esse número. Gere um novo código na lista de pessoas.");
      const profile = await profileByName(tx, input.profileName);
      const [member] = await tx
        .insert(s.members)
        .values({ familyId: actor.familyId, profileId: profile.id, name: input.name, roleLabel: input.relation?.trim() || null })
        .returning({ id: s.members.id });
      await tx.insert(s.invites).values({
        familyId: actor.familyId, kind: "whatsapp", profileId: profile.id, memberId: member!.id, expectedPhone: phone,
        codeHash: hashConviteCodigo(phone, code), expiresAt, createdByMemberId: actor.memberId,
      });
      await audit(tx, actor, "member.invite", "member", member!.id, { kind: "whatsapp", profile: input.profileName });
      return member!.id;
    });
    return { kind: "whatsapp", memberId, memberName: input.name, code, expectedPhone: phone, expiresLabel: stampLabel(expiresAt, actor.timezone) };
  } catch (e) {
    // o índice de convite ativo é global: o número pode ter convite em outra família (sem revelar qual)
    if (isUniqueViolation(e)) throw new UserError("Esse número já tem um convite em andamento.");
    throw e;
  }
}

/** Novo código para um convite por WhatsApp (o anterior é revogado). */
export async function regenerateWhatsappCode(actor: Actor, memberId: string): Promise<InviteOutcome> {
  requirePermission(actor, "members.manage");
  const code = gerarCodigoVerificacao();
  const expiresAt = new Date(Date.now() + VALIDADE_CONVITE_MS);
  return withFamilia(actor.familyId, async (tx) => {
    const { m } = await loadMember(tx, memberId);
    if (m.accessState !== "invited") throw new UserError("Essa pessoa já entrou; não há convite a renovar.");
    const [old] = await tx
      .select()
      .from(s.invites)
      .where(and(eq(s.invites.memberId, memberId), eq(s.invites.kind, "whatsapp"), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
    if (!old?.expectedPhone) throw new UserError("Essa pessoa não tem convite por WhatsApp.");
    await tx.update(s.invites).set({ revokedAt: new Date() }).where(eq(s.invites.id, old.id));
    await tx.insert(s.invites).values({
      familyId: actor.familyId, kind: "whatsapp", profileId: old.profileId, memberId, expectedPhone: old.expectedPhone,
      codeHash: hashConviteCodigo(old.expectedPhone, code), expiresAt, createdByMemberId: actor.memberId,
    });
    await audit(tx, actor, "member.invite_renew", "member", memberId, { kind: "whatsapp" });
    return { kind: "whatsapp" as const, memberId, memberName: m.name, code, expectedPhone: old.expectedPhone, expiresLabel: stampLabel(expiresAt, actor.timezone) };
  });
}

/** Reenvia o convite por e-mail: link novo (o antigo deixa de valer) e mais 24 h. */
export async function resendEmailInvite(actor: Actor, memberId: string, deps: Deps): Promise<InviteOutcome> {
  requirePermission(actor, "members.manage");
  const link = gerarTokenPrimeiroAcesso();
  const expiresAt = new Date(Date.now() + VALIDADE_CONVITE_MS);
  const info = await withFamilia(actor.familyId, async (tx) => {
    const { m } = await loadMember(tx, memberId);
    if (m.accessState !== "invited" || !m.email) throw new UserError("Essa pessoa não tem convite por e-mail pendente.");
    const [inv] = await tx
      .select()
      .from(s.invites)
      .where(and(eq(s.invites.memberId, memberId), eq(s.invites.kind, "email"), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
    if (!inv) throw new UserError("Essa pessoa não tem convite por e-mail pendente.");
    await tx.update(s.firstAccessLinks).set({ revokedAt: new Date() }).where(and(eq(s.firstAccessLinks.memberId, memberId), isNull(s.firstAccessLinks.consumedAt), isNull(s.firstAccessLinks.revokedAt)));
    await tx.update(s.invites).set({ expiresAt }).where(eq(s.invites.id, inv.id));
    await tx.insert(s.firstAccessLinks).values({ familyId: actor.familyId, memberId, tokenHash: link.hash, expiresAt });
    await audit(tx, actor, "member.invite_resend", "member", memberId, { kind: "email" });
    return { email: m.email, name: m.name };
  });
  const emailSent = await trySend(deps, info.email, link.token);
  return { kind: "email", memberId, memberName: info.name, emailSent, expiresLabel: stampLabel(expiresAt, actor.timezone) };
}

/** Cancela um convite que ainda não foi aceito (apaga a pessoa convidada, que nunca entrou). */
export async function revokeInvite(actor: Actor, memberId: string): Promise<void> {
  requirePermission(actor, "members.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const { m, profileName } = await loadMember(tx, memberId);
    if (m.accessState !== "invited") throw new UserError("Essa pessoa já entrou. Use Desativar.");
    assertMayGive(actor, profileName);
    await tx.update(s.patients).set({ selfMemberId: null }).where(eq(s.patients.selfMemberId, memberId));
    await audit(tx, actor, "member.invite_revoke", "member", memberId, { profile: profileName });
    try {
      await tx.delete(s.members).where(eq(s.members.id, memberId));
    } catch (e) {
      if (pgCode(e) === "23503") throw new UserError("Essa pessoa já tem registros ligados a ela e não pode ser apagada.");
      throw e;
    }
  });
}

export interface MemberPatch {
  name: string;
  profileName: string;
  relation?: string;
}

/** Edita nome, relação e perfil. Só um Administrador mexe em Administrador; ninguém muda o próprio perfil. */
export async function updateMember(actor: Actor, memberId: string, patch: MemberPatch): Promise<void> {
  requirePermission(actor, "members.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const { m, profileName: currentProfile } = await loadMember(tx, memberId);
    const changesProfile = patch.profileName !== currentProfile;
    if (changesProfile) {
      if (memberId === actor.memberId) throw new UserError("Você não pode mudar o seu próprio perfil.");
      if (currentProfile === ADMIN || patch.profileName === ADMIN) {
        if (!isAdmin(actor)) throw new UserError("Só um Administrador pode dar ou tirar o perfil Administrador.");
      }
      if (currentProfile === ADMIN && m.active && m.accessState === "active" && (await otherActiveAdmins(tx, memberId)) === 0) {
        throw new UserError("A família precisa ter ao menos um Administrador.");
      }
    }
    const profile = await profileByName(tx, patch.profileName);
    await tx
      .update(s.members)
      .set({ name: patch.name, roleLabel: patch.relation?.trim() || null, profileId: profile.id })
      .where(eq(s.members.id, memberId));
    if (changesProfile) {
      // o convite pendente acompanha o perfil escolhido
      await tx.update(s.invites).set({ profileId: profile.id }).where(and(eq(s.invites.memberId, memberId), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
    }
    await audit(tx, actor, "member.update", "member", memberId, changesProfile ? { from: currentProfile, to: patch.profileName } : {});
  });
}

/** Desativa: some das listas de quem recebe avisos, perde o acesso e as sessões do Appwrite são derrubadas. Reversível. */
export async function deactivateMember(actor: Actor, memberId: string, deps: Deps): Promise<void> {
  requirePermission(actor, "members.manage");
  if (memberId === actor.memberId) throw new UserError("Você não pode desativar a si mesmo.");
  const appwriteUserId = await withFamilia(actor.familyId, async (tx) => {
    const { m, profileName } = await loadMember(tx, memberId);
    if (m.accessState === "invited") throw new UserError("Essa pessoa ainda não entrou. Use Cancelar convite.");
    if (profileName === ADMIN && !isAdmin(actor)) throw new UserError("Só um Administrador pode desativar outro Administrador.");
    if (profileName === ADMIN && m.active && (await otherActiveAdmins(tx, memberId)) === 0) {
      throw new UserError("A família precisa ter ao menos um Administrador ativo.");
    }
    await tx.update(s.members).set({ active: false, removedAt: new Date() }).where(eq(s.members.id, memberId));
    await audit(tx, actor, "member.deactivate", "member", memberId, { profile: profileName });
    return m.appwriteUserId;
  });
  // depois do commit: o acesso já está negado pelo banco; agora derruba as sessões e bloqueia o login no Appwrite
  if (appwriteUserId) {
    await deps.auth.revokeSessions(appwriteUserId);
    await deps.auth.setEnabled(appwriteUserId, false);
  }
}

export async function reactivateMember(actor: Actor, memberId: string, deps: Deps): Promise<void> {
  requirePermission(actor, "members.manage");
  const appwriteUserId = await withFamilia(actor.familyId, async (tx) => {
    const { m, profileName } = await loadMember(tx, memberId);
    if (profileName === ADMIN && !isAdmin(actor)) throw new UserError("Só um Administrador pode reativar outro Administrador.");
    await tx.update(s.members).set({ active: true, removedAt: null }).where(eq(s.members.id, memberId));
    await audit(tx, actor, "member.reactivate", "member", memberId, { profile: profileName });
    return m.appwriteUserId;
  });
  if (appwriteUserId) await deps.auth.setEnabled(appwriteUserId, true);
}

/**
 * WhatsApp da própria conta: fica PENDENTE. A validação real (o dono do número envia o código ao sistema)
 * chega no Lote 4; até lá o portal funciona normalmente e nenhuma mensagem é enviada.
 */
export async function saveMyPhone(actor: Actor, raw: string): Promise<void> {
  const text = String(raw ?? "").trim();
  const phone = text ? normalizePhone(text) : null;
  if (text && !phone) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
  await withFamilia(actor.familyId, async (tx) => {
    const { m } = await loadMember(tx, actor.memberId);
    if ((m.phonePending ?? null) === phone) return;
    await tx
      .update(s.members)
      .set({ phonePending: phone, verificationCodeHash: null, verificationExpiresAt: null, verificationAttempts: 0 })
      .where(eq(s.members.id, actor.memberId));
    await audit(tx, actor, phone ? "member.phone_pending" : "member.phone_clear", "member", actor.memberId, {});
  });
}
