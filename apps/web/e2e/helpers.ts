import { expect, type Page } from "@playwright/test";

/** Telefones fictícios da família demo (scripts/appwrite/src/seed.ts): Ana é a 1ª, Seu João a 8ª. */
export const PHONE = {
  ana: "(11) 90000-0001",
  claudia: "(11) 90000-0003",
  lucas: "(11) 90000-0005",
  joao: "(11) 90000-0008",
} as const;
// O limitador de envio de código (10 por hora por telefone) é real. Cada telefone pede no máximo 1 código por execução.
export const AUTH = { ana: "e2e/.auth/ana.json", joao: "e2e/.auth/joao.json" } as const;

/** Espera a hidratação do React (antes disso os cliques não fazem nada). */
export async function hydrated(page: Page) {
  await page.locator("body[data-hydrated]").waitFor({ state: "attached" });
}

/** Abre uma página e espera ela ficar interativa. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await hydrated(page);
}

/** Login por código de 6 dígitos: o código vem do canal falso (modo de teste), nunca de um número real. */
export async function login(page: Page, phone: string) {
  const digits = phone.replace(/\D/g, "");
  await page.request.delete(`/api/test/last-login-code?phone=${digits}`); // zera o limite de envios do telefone de teste
  const base = await page.request.get(`/api/test/last-login-code?phone=${digits}`);
  const baseline = base.ok() ? ((await base.json()) as { index: number }).index : -1;
  await open(page, "/login");
  await page.getByLabel("Celular com DDD").fill(phone);
  await page.getByRole("button", { name: "Receber código" }).click();
  const field = page.getByLabel("Código de 6 números");
  await expect(field).toBeVisible();
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/test/last-login-code?phone=${digits}`);
        const body = res.ok() ? ((await res.json()) as { code: string; index: number }) : undefined;
        code = body && body.index > baseline ? body.code : undefined;
        return code;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^\d{6}$/);
  await field.fill(code!);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}
