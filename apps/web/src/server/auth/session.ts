import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE, SESSION_TTL_SEC } from "../cookies";
import { accountOfSession, deleteCurrentSession, type AuthAccount } from "./appwrite";

const cookieOptions = (expires?: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  // Secure em produção (HTTPS no staging); o e2e roda `next start` em http://localhost
  secure: process.env["NODE_ENV"] === "production" && process.env["E2E_TEST_MODE"] !== "1",
  path: "/",
  ...(expires ? { expires } : { maxAge: SESSION_TTL_SEC }),
});

/** Guarda o segredo da sessão do Appwrite em cookie httpOnly. Nunca vai ao JavaScript do navegador. */
export async function writeSession(secret: string, expire?: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, secret, cookieOptions(expire ? new Date(expire) : undefined));
}

export const sessionSecret = async (): Promise<string | null> => (await cookies()).get(SESSION_COOKIE)?.value ?? null;

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  await deleteCurrentSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}

/** Conta do Appwrite dona da sessão do cookie, validada no Appwrite a cada requisição. */
export const currentAccount = cache(async (): Promise<AuthAccount | null> => accountOfSession(await sessionSecret()));
