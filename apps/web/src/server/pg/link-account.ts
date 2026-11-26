import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { consumirLinkPrimeiroAcesso, listarVinculosDaConta, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { audit } from "./audit";
import { isUniqueViolation } from "./errors";

/**
 * Liga um vínculo pendente (convite por e-mail ou primeiro acesso do WhatsApp) a uma conta JÁ AUTENTICADA (docs/15, 4.3 e 4.4).
 * Quem chama já provou as duas coisas: o link (token) e a conta (senha ou sessão válida). Aqui não se muda senha nem nome.
 */
export interface LinkTarget {
  familyId: string;
  memberId: string;
  tokenHash: string;
  /** estado em que o vínculo precisa estar: convite por e-mail ou primeiro acesso de quem veio pelo WhatsApp */
  from: "invited" | "whatsapp_verified";
}

export type LinkResult = "ok" | "invalid" | "already_member" | "email_taken";

export async function linkMemberToAccount(target: LinkTarget, account: { id: string; email: string }): Promise<LinkResult> {
  const email = account.email.toLowerCase();
  if ((await listarVinculosDaConta(account.id)).some((v) => v.familiaId === target.familyId)) return "already_member";
  const check = await withFamilia(target.familyId, async (tx) => {
    const [m] = await tx.select({ active: s.members.active, removed: s.members.removedAt, state: s.members.accessState }).from(s.members).where(eq(s.members.id, target.memberId));
    if (!m || !m.active || m.removed || m.state !== target.from) return "invalid" as const;
    const taken = await tx.select({ id: s.members.id }).from(s.members).where(and(sql`lower(${s.members.email}) = ${email}`, ne(s.members.id, target.memberId)));
    return taken.length ? ("email_taken" as const) : ("ok" as const);
  });
  if (check !== "ok") return check;
  if (!(await consumirLinkPrimeiroAcesso(target.tokenHash))) return "invalid";
  try {
    await withFamilia(target.familyId, async (tx) => {
      await tx
        .update(s.members)
        .set({ accessState: "active", appwriteUserId: account.id, email, emailConfirmedAt: new Date() })
        .where(and(eq(s.members.id, target.memberId), eq(s.members.accessState, target.from)));
      await tx
        .update(s.invites)
        .set({ consumedAt: new Date() })
        .where(and(eq(s.invites.memberId, target.memberId), eq(s.invites.kind, "email"), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
      await audit(tx, { familyId: target.familyId, memberId: target.memberId }, "member.link_account", "member", target.memberId, { from: target.from });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return "already_member";
    throw e;
  }
  return "ok";
}

/** Conta que já é de alguém: e-mail confirmado OU com algum vínculo. Só conta "nova" pode ter a senha definida por um convite. */
export async function isExistingAccount(account: { id: string; emailVerified: boolean } | null): Promise<boolean> {
  if (!account) return false;
  return account.emailVerified || (await listarVinculosDaConta(account.id)).length > 0;
}
