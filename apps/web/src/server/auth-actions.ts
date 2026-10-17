"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_TTL_SEC } from "./session-token";

/** Pede o código. A resposta é sempre a mesma, exista o número ou não (RF0.2). */
export async function requestCodeAction(phone: string): Promise<{ ok: true }> {
  const { services } = await import("./services");
  return services().login.requestCode(String(phone).slice(0, 30));
}

/** Confere o código e, se certo, grava o cookie de sessão httpOnly. Falha sempre devolve o mesmo `{ ok: false }`. */
export async function verifyCodeAction(phone: string, code: string): Promise<{ ok: boolean }> {
  const { services } = await import("./services");
  const res = await services().login.verifyCode(String(phone).slice(0, 30), String(code).slice(0, 6));
  if (!res.ok) return { ok: false };
  (await cookies()).set(SESSION_COOKIE, res.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production" && process.env["E2E_TEST_MODE"] !== "1",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return { ok: true };
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
