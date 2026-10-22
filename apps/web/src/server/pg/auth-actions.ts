"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ativarMembroPorEmail, consumirLinkPrimeiroAcesso, resolverLinkPrimeiroAcesso, resolverMembroPorAppwriteUser, sha256, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { and, eq, isNull } from "drizzle-orm";
import {
  accountOfSession, appwriteCode, confirmVerification, createUser, finishRecovery, revokeUserSessions, sendInviteEmail, sendRecovery,
  sendVerification, sessionFromMagicUrl, setUserName, setUserPassword, signInWithPassword,
} from "../auth/appwrite";
import { clearSession, currentAccount, sessionSecret, writeSession } from "../auth/session";
import { appUrl } from "../env";
import { audit } from "./audit";
import { UserError, isUniqueViolation } from "./errors";
import { createFamilyWithAdmin } from "./families";

/** Estado devolvido aos formulários das telas de entrada (useActionState). */
export type FormState = { error?: string; ok?: string; values?: Record<string, string> };

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Confira os dados informados.";
const email = z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(160);
const password = z.string().min(8, "A senha precisa ter ao menos 8 caracteres.").max(128, "A senha é longa demais.");

const fd = (f: FormData, k: string) => String(f.get(k) ?? "");
const same = (a: string, b: string) => a === b;

// ---------- entrar / sair ----------

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const p = z.object({ email, password: z.string().min(1).max(128) }).safeParse({ email: fd(form, "email"), password: fd(form, "senha") });
  const keep = { email: fd(form, "email") };
  if (!p.success) return { error: "Informe e-mail e senha.", values: keep };
  try {
    const session = await signInWithPassword(p.data.email, p.data.password);
    const account = await accountOfSession(session.secret);
    const member = account ? await resolverMembroPorAppwriteUser(account.id) : null;
    if (member && !member.ativo) {
      return { error: "Seu acesso foi desativado. Fale com quem administra a família.", values: keep };
    }
    await writeSession(session.secret, form.get("lembrar") ? session.expire : undefined);
  } catch (e) {
    return { error: appwriteCode(e) === 429 ? "Muitas tentativas. Aguarde um pouco e tente de novo." : "E-mail ou senha incorretos.", values: keep };
  }
  redirect("/");
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect("/login");
}

// ---------- criar conta e verificar e-mail ----------

const VERIF_COOKIE = "mc_verif_envio";
const VERIF_INTERVAL_S = 120;
async function markVerificationSent() {
  (await cookies()).set(VERIF_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", path: "/", maxAge: VERIF_INTERVAL_S });
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const p = z
    .object({ name: z.string().trim().min(2, "Informe o seu nome.").max(80), email, password })
    .safeParse({ name: fd(form, "nome"), email: fd(form, "email"), password: fd(form, "senha") });
  const keep = { nome: fd(form, "nome"), email: fd(form, "email") };
  if (!p.success) return { error: firstIssue(p.error), values: keep };
  if (!same(p.data.password, fd(form, "confirmar"))) return { error: "As senhas não conferem.", values: keep };
  try {
    await createUser(p.data.email, p.data.password, p.data.name);
    const session = await signInWithPassword(p.data.email, p.data.password);
    await writeSession(session.secret, session.expire);
    // o e-mail de confirmação (modelo do Appwrite) não bloqueia o cadastro: dá para pedir de novo na tela seguinte
    await sendVerification(session.secret).then(markVerificationSent).catch((e) => console.error("[cadastro] verificação não enviada", appwriteCode(e) ?? ""));
  } catch (e) {
    if (appwriteCode(e) === 409) return { error: "Já existe uma conta com esse e-mail. Tente entrar ou use \"Esqueci minha senha\".", values: keep };
    if (appwriteCode(e) === 429) return { error: "Muitas tentativas. Aguarde um pouco e tente de novo.", values: keep };
    console.error("[cadastro]", appwriteCode(e) ?? (e as Error).name);
    return { error: "Não foi possível criar a conta agora. Tente de novo.", values: keep };
  }
  redirect("/verificar-email");
}

export async function resendVerification(): Promise<FormState> {
  const secret = await sessionSecret();
  if (!secret) redirect("/login");
  const last = Number((await cookies()).get(VERIF_COOKIE)?.value ?? 0);
  if (Date.now() - last < VERIF_INTERVAL_S * 1000) return { error: "Aguarde 2 minutos para pedir outro e-mail." };
  try {
    await sendVerification(secret);
    await markVerificationSent();
    return { ok: "Enviamos o e-mail de confirmação. Veja a caixa de entrada e a de spam." };
  } catch (e) {
    console.error("[verificacao]", appwriteCode(e) ?? "");
    return { error: appwriteCode(e) === 429 ? "Muitas tentativas. Aguarde um pouco." : "Não foi possível enviar agora. Tente de novo." };
  }
}

/** "Já confirmei": confere no Appwrite e segue para a criação da família. */
export async function checkEmailConfirmed(): Promise<FormState> {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!account.emailVerified) return { error: "Ainda não vimos a confirmação. Abra o link do e-mail e tente de novo." };
  // quem veio do convite de WhatsApp vira `active` aqui; os demais seguem para criar a família
  redirect((await ativarMembroPorEmail(account.email, account.id)) ? "/" : "/criar-familia");
}

/** Só confirma no clique do botão (prévias de e-mail e antivírus abririam o link e gastariam o token). */
export async function confirmEmail(_: FormState, form: FormData): Promise<FormState> {
  const userId = fd(form, "userId");
  const secret = fd(form, "secret");
  if (!userId || !secret) return { error: "Link inválido ou vencido. Entre e peça um novo e-mail de confirmação." };
  try {
    await confirmVerification(userId, secret);
    return { ok: "E-mail confirmado!" };
  } catch {
    return { error: "Link inválido ou vencido. Entre e peça um novo e-mail de confirmação." };
  }
}

// ---------- primeira entrada: criar a família ----------

export async function createFamily(_: FormState, form: FormData): Promise<FormState> {
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!account.emailVerified) redirect("/verificar-email");
  if (await resolverMembroPorAppwriteUser(account.id)) redirect("/");
  const p = z.string().trim().min(2, "Dê um nome para a família.").max(80).safeParse(fd(form, "nomeFamilia"));
  if (!p.success) return { error: firstIssue(p.error), values: { nomeFamilia: fd(form, "nomeFamilia") } };
  try {
    await createFamilyWithAdmin({ appwriteUserId: account.id, name: account.name || account.email, email: account.email, familyName: p.data });
  } catch (e) {
    if (e instanceof UserError) redirect("/");
    console.error("[criar-familia]", (e as Error).name);
    return { error: "Não foi possível criar a família. Tente de novo.", values: { nomeFamilia: p.data } };
  }
  redirect("/");
}

// ---------- esqueci / redefinir a senha ----------

export async function forgotPassword(_: FormState, form: FormData): Promise<FormState> {
  const p = email.safeParse(fd(form, "email"));
  if (!p.success) return { error: firstIssue(p.error), values: { email: fd(form, "email") } };
  await sendRecovery(p.data).catch(() => {}); // não revela se o e-mail existe
  return { ok: "Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.", values: { email: p.data } };
}

export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const pw = password.safeParse(fd(form, "senha"));
  if (!pw.success) return { error: firstIssue(pw.error) };
  if (!same(pw.data, fd(form, "confirmar"))) return { error: "As senhas não conferem." };
  const userId = fd(form, "userId");
  try {
    await finishRecovery(userId, fd(form, "secret"), pw.data);
    await revokeUserSessions(userId); // quem tinha a senha antiga perde o acesso
  } catch {
    return { error: "Link inválido ou vencido. Peça um novo." };
  }
  redirect("/login?ok=senha");
}

// ---------- aceitar convite por e-mail ----------

const INVITE_ERROR = "Este convite não vale mais. Peça um novo a quem administra a família.";

/**
 * O convidado abre o link do e-mail (Magic URL do Appwrite + token do convite), define a senha e entra com o perfil
 * escolhido. O e-mail fica confirmado porque só quem recebeu o e-mail tem o link.
 */
export async function acceptInvite(_: FormState, form: FormData): Promise<FormState> {
  const pw = password.safeParse(fd(form, "senha"));
  if (!pw.success) return { error: firstIssue(pw.error) };
  if (!same(pw.data, fd(form, "confirmar"))) return { error: "As senhas não conferem." };
  const token = fd(form, "t");
  const userId = fd(form, "userId");
  const secret = fd(form, "secret");
  if (!token || !userId || !secret) return { error: INVITE_ERROR };

  const link = await resolverLinkPrimeiroAcesso(sha256(token));
  if (!link || link.estadoAcesso !== "invited" || !link.email) return { error: INVITE_ERROR };

  let session;
  try {
    session = await sessionFromMagicUrl(userId, secret);
  } catch {
    return { error: "O link do e-mail venceu. Peça um novo e-mail de convite abaixo." };
  }
  try {
    const account = await accountOfSession(session.secret);
    if (!account || account.email.toLowerCase() !== link.email.toLowerCase()) {
      await revokeUserSessions(session.userId);
      return { error: INVITE_ERROR };
    }
    const member = await withFamilia(link.familiaId, async (tx) => {
      const [m] = await tx.select({ name: s.members.name, active: s.members.active }).from(s.members).where(eq(s.members.id, link.membroId));
      return m;
    });
    if (!member?.active) return { error: INVITE_ERROR };

    await setUserPassword(session.userId, pw.data);
    await setUserName(session.userId, member.name).catch(() => {});
    // sessões antigas da conta (ex.: alguém que se cadastrou antes com este e-mail) deixam de valer
    await revokeUserSessions(session.userId);

    const used = await consumirLinkPrimeiroAcesso(sha256(token));
    if (!used) return { error: INVITE_ERROR };

    await withFamilia(link.familiaId, async (tx) => {
      await tx
        .update(s.members)
        .set({ accessState: "active", appwriteUserId: session.userId, emailConfirmedAt: new Date() })
        .where(and(eq(s.members.id, link.membroId), eq(s.members.accessState, "invited")));
      await tx
        .update(s.invites)
        .set({ consumedAt: new Date() })
        .where(and(eq(s.invites.memberId, link.membroId), eq(s.invites.kind, "email"), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
      await audit(tx, { familyId: link.familiaId, memberId: link.membroId }, "member.accept_invite", "member", link.membroId, { kind: "email" });
    });

    const fresh = await signInWithPassword(link.email, pw.data);
    await writeSession(fresh.secret, fresh.expire);
  } catch (e) {
    if (isUniqueViolation(e)) return { error: "Este e-mail já pertence a outra família. Fale com quem administra a família." };
    console.error("[aceitar-convite]", appwriteCode(e) ?? (e as Error).name);
    return { error: "Não foi possível concluir. Peça um novo e-mail de convite." };
  }
  redirect("/");
}

const RESEND_COOKIE = "mc_convite_reenvio";

/** O e-mail do Appwrite vale por pouco tempo; o convite vale 24 h. Aqui o convidado pede um e-mail novo. */
export async function resendInviteEmail(_: FormState, form: FormData): Promise<FormState> {
  const token = fd(form, "t");
  const jar = await cookies();
  if (Date.now() - Number(jar.get(RESEND_COOKIE)?.value ?? 0) < 60_000) return { error: "Aguarde 1 minuto para pedir outro e-mail." };
  const link = token ? await resolverLinkPrimeiroAcesso(sha256(token)) : null;
  if (!link?.email) return { error: INVITE_ERROR };
  try {
    await sendInviteEmail(link.email, `${appUrl()}/aceitar-convite?t=${token}`);
    jar.set(RESEND_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 });
    return { ok: "Enviamos um novo e-mail. Abra o link mais recente." };
  } catch {
    return { error: "Não foi possível enviar agora. Peça a quem administra a família para reenviar o convite." };
  }
}
