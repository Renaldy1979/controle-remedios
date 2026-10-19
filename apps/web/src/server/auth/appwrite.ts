import "server-only";
import { Account, Client, ID, Query, Users } from "node-appwrite";
import { appUrl, appwriteAuthEnv, e2eTestMode } from "../env";

/**
 * Appwrite Auth (e-mail/senha). Só o servidor fala com o Appwrite; a chave de API nunca vai ao navegador.
 * Os e-mails (verificação, recuperação de senha, convite) saem dos modelos do Appwrite (docs/09).
 */
const base = () => {
  const e = appwriteAuthEnv();
  return new Client().setEndpoint(e.endpoint).setProject(e.projectId).setLocale("pt-br");
};
const admin = () => base().setKey(appwriteAuthEnv().apiKey);
const anon = () => base();
const asSession = (secret: string) => base().setSession(secret);

export const appwriteCode = (e: unknown): number | undefined => (e as { code?: number } | null)?.code;

/** Com a chave de API o Appwrite devolve o segredo da sessão (fluxo SSR). */
export async function signInWithPassword(email: string, password: string) {
  return new Account(admin()).createEmailPasswordSession({ email, password });
}

export async function createUser(email: string, password: string | undefined, name: string) {
  return new Users(admin()).create({ userId: ID.unique(), email, password, name });
}

export async function deleteUser(userId: string): Promise<void> {
  try {
    await new Users(admin()).delete({ userId });
  } catch (e) {
    if (appwriteCode(e) !== 404) throw e;
  }
}

export interface AuthAccount {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** Dono da sessão, ou null se ela não vale mais (expirada, revogada, inexistente). */
export async function accountOfSession(secret: string | undefined | null): Promise<AuthAccount | null> {
  if (!secret) return null;
  try {
    const a = await new Account(asSession(secret)).get();
    return { id: a.$id, email: a.email, name: a.name, emailVerified: a.emailVerification === true };
  } catch {
    return null;
  }
}

export async function deleteCurrentSession(secret: string | undefined | null): Promise<void> {
  if (!secret) return;
  try {
    await new Account(asSession(secret)).deleteSession({ sessionId: "current" });
  } catch {
    /* já estava inválida */
  }
}

/** Derruba TODAS as sessões da pessoa (desativação). */
export async function revokeUserSessions(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    await new Users(admin()).deleteSessions({ userId });
  } catch (e) {
    if (appwriteCode(e) !== 404) throw e;
  }
}

/** Bloqueia/libera o login da pessoa no Appwrite (desativar/reativar). */
export async function setUserEnabled(userId: string | null | undefined, enabled: boolean): Promise<void> {
  if (!userId) return;
  try {
    await new Users(admin()).updateStatus({ userId, status: enabled });
  } catch (e) {
    if (appwriteCode(e) !== 404) throw e;
  }
}

// ---------- verificação de e-mail ----------
export async function sendVerification(sessionSecret: string): Promise<void> {
  await new Account(asSession(sessionSecret)).createVerification({ url: `${appUrl()}/verificar-email` });
}
export async function confirmVerification(userId: string, secret: string): Promise<void> {
  await new Account(anon()).updateVerification({ userId, secret });
}

// ---------- recuperação de senha ----------
export async function sendRecovery(email: string): Promise<void> {
  await new Account(anon()).createRecovery({ email, url: `${appUrl()}/redefinir-senha` });
}
export async function finishRecovery(userId: string, secret: string, password: string): Promise<void> {
  await new Account(anon()).updateRecovery({ userId, secret, password });
}

// ---------- convite por e-mail (Magic URL do Appwrite) ----------
const g = globalThis as unknown as { __mcTestInviteLinks?: Map<string, string> };

/** Só no modo de teste (e2e): último link de convite gerado para cada e-mail. */
export const testInviteLink = (email: string): string | undefined => g.__mcTestInviteLinks?.get(email.toLowerCase());

/**
 * Envia o e-mail de convite: link do Magic URL do Appwrite que volta para `url` com `userId` e `secret`.
 * No modo de teste não envia e-mail: cria o token pela API e guarda o link para o teste abrir.
 */
export async function sendInviteEmail(email: string, url: string): Promise<void> {
  if (!e2eTestMode()) {
    await new Account(anon()).createMagicURLToken({ userId: ID.unique(), email, url });
    return;
  }
  const users = new Users(admin());
  const found = await users.list({ queries: [Query.equal("email", [email]), Query.limit(1)] });
  const user = found.users[0] ?? (await users.create({ userId: ID.unique(), email }));
  const token = await users.createToken({ userId: user.$id });
  const u = new URL(url);
  u.searchParams.set("userId", user.$id);
  u.searchParams.set("secret", token.secret);
  (g.__mcTestInviteLinks ??= new Map()).set(email.toLowerCase(), u.toString());
}

/** Troca o token do Magic URL por sessão; o Appwrite também marca o e-mail como verificado. */
export async function sessionFromMagicUrl(userId: string, secret: string) {
  return new Account(admin()).createSession({ userId, secret });
}
export async function setUserPassword(userId: string, password: string): Promise<void> {
  await new Users(admin()).updatePassword({ userId, password });
}
export async function setUserName(userId: string, name: string): Promise<void> {
  await new Users(admin()).updateName({ userId, name });
}
/** Para o e2e: marca o e-mail como verificado sem clicar no link. Só chamado pelos testes. */
export async function markEmailVerified(userId: string): Promise<void> {
  await new Users(admin()).updateEmailVerification({ userId, emailVerification: true });
}
