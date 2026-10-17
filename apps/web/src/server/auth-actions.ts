"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FAMILY_COOKIE, SESSION_COOKIE, SESSION_TTL_SEC } from "./cookies";

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  // Secure em produção; o modo de teste roda `next start` em http://localhost
  secure: process.env["NODE_ENV"] === "production" && process.env["E2E_TEST_MODE"] !== "1",
  path: "/",
  maxAge: SESSION_TTL_SEC,
});

/** Pede o código. A resposta é sempre a mesma, exista o número ou não (RF0.2). */
export async function requestCodeAction(phone: string): Promise<{ ok: true }> {
  const { services } = await import("./services");
  return services().login.requestCode(String(phone).slice(0, 30));
}

/**
 * Confere o código; se certo, o token customizado do Appwrite vira uma SESSÃO do Appwrite e o segredo dela
 * vai para o cookie httpOnly. Falha sempre devolve o mesmo `{ ok: false }`.
 */
export async function verifyCodeAction(phone: string, code: string): Promise<{ ok: boolean }> {
  const { services } = await import("./services");
  const { createSessionFromToken } = await import("./session");
  const res = await services().login.verifyCode(String(phone).slice(0, 30), String(code).slice(0, 6));
  if (!res.ok) return { ok: false };
  let secret: string;
  try {
    secret = await createSessionFromToken(res.userId, res.token);
  } catch {
    return { ok: false };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, secret, cookieOptions());
  jar.delete(FAMILY_COOKIE); // nova entrada: a família é decidida de novo
  return { ok: true };
}

/** "Qual família?": só aceita uma das famílias DESTA pessoa (conferido no servidor). */
export async function chooseFamilyAction(familyId: string): Promise<{ ok: boolean }> {
  const { userOfSession, membershipsOf } = await import("./session");
  const jar = await cookies();
  const userId = await userOfSession(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return { ok: false };
  const id = String(familyId).slice(0, 64);
  if (!(await membershipsOf(userId)).some((m) => m.familyId === id)) return { ok: false };
  jar.set(FAMILY_COOKIE, id, cookieOptions());
  return { ok: true };
}

/** Sair: apaga a sessão no Appwrite e os cookies. */
export async function logoutAction(): Promise<void> {
  const { deleteSession } = await import("./session");
  const jar = await cookies();
  await deleteSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  jar.delete(FAMILY_COOKIE);
  redirect("/login");
}
