import { expect, type Page } from "@playwright/test";
import { Client, Query, Users } from "node-appwrite";
import postgres from "postgres";

/**
 * Apoio do e2e. Só toca o que tem o prefixo `zz-test-`: usuários do Appwrite (Auth) e as famílias do Postgres que eles
 * criaram. A chave de API é lida do .env da raiz e nunca é impressa.
 */
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  /* sem .env: vale o ambiente */
}

export const PREFIX = "zz-test-";
export const PASSWORD = "Senha-de-teste-9";

const users = () => {
  const { APPWRITE_ENDPOINT: e, APPWRITE_PROJECT_ID: p, APPWRITE_API_KEY: k } = process.env;
  if (!e || !p || !k) throw new Error("Defina APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID e APPWRITE_API_KEY no .env da raiz");
  return new Users(new Client().setEndpoint(e).setProject(p).setKey(k));
};

export const testEmail = (tag: string) => `${PREFIX}${tag}-${Date.now().toString(36)}@example.com`;

/** Simula o clique no e-mail de confirmação (o Appwrite real manda o e-mail; o teste não lê caixa de entrada). */
export async function verifyEmail(email: string): Promise<void> {
  const u = users();
  const found = await u.list({ queries: [Query.equal("email", [email]), Query.limit(1)] });
  const user = found.users[0];
  if (!user) throw new Error("usuário de teste não existe no Appwrite");
  await u.updateEmailVerification({ userId: user.$id, emailVerification: true });
}

const ORDER = [
  "message_log", "notifications", "replenishment_steps", "stock_movements", "replenishments", "prescription_views",
  "prescription_shares", "prescription_items", "prescription_files", "prescriptions", "dose_events", "stock_items",
  "treatment_phases", "treatments", "care_assignments", "audit_log", "patients", "medications", "first_access_links",
  "invites", "members", "profiles", "api_keys", "idempotency", "families",
];

/** Apaga TUDO que o e2e criou: usuários `zz-test-*` do Appwrite e as famílias deles no Postgres. Idempotente. */
export async function cleanup(): Promise<{ appwriteUsers: number; families: number }> {
  let removedUsers = 0;
  const u = users();
  for (;;) {
    const page = await u.list({ queries: [Query.limit(100)] });
    const mine = page.users.filter((x) => x.email.startsWith(PREFIX));
    for (const x of mine) {
      await u.delete({ userId: x.$id });
      removedUsers++;
    }
    if (mine.length === 0) break;
  }

  const sql = postgres(process.env["DATABASE_URL_ADMIN"] ?? "postgres://medcuidar_owner:medcuidar_owner_dev@localhost:5440/medcuidar", { max: 1, onnotice: () => {} });
  try {
    const fams = await sql`select distinct family_id from members where email like ${`${PREFIX}%`} or name like ${`${PREFIX}%`}`;
    const ids = fams.map((r) => r["family_id"] as string);
    if (ids.length) {
      for (const t of ORDER) await sql.unsafe(`delete from ${t} where ${t === "families" ? "id" : "family_id"} = any($1::uuid[])`, [ids]);
      await sql`delete from phone_lockouts where phone like '5599%'`;
    }
    return { appwriteUsers: removedUsers, families: ids.length };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** Espera a hidratação do React (antes disso os cliques não fazem nada). */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator("body[data-hydrated]").waitFor({ state: "attached" });
}

export async function signUp(page: Page, name: string, email: string) {
  await open(page, "/criar-conta");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repita a senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/verificar-email$/);
  await expect(page.getByRole("heading", { name: "Confirme o seu e-mail" })).toBeVisible();
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await open(page, "/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}
