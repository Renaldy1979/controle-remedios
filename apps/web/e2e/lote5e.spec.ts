import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, aceitarPrivacidade, cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Roteiro do Lote 5E-A (docs/lotes/L5E-A-roteiro.md): quem já tem conta (e a própria família) recebe um convite, aceita com a
 * mesma senha, troca de família, cria outra, e a desativação numa delas não atinge as outras. Appwrite do .env (só Auth).
 */
test.describe.configure({ mode: "serial" });

const emailDono = testEmail("e5-dono");
const emailPessoa = testEmail("e5-pessoa");
const base = `http://localhost:${process.env["E2E_PORT"] ?? 3100}`;

test.beforeAll(async () => {
  await cleanup();
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

async function newOwner(page: Page, name: string, email: string, family: string) {
  await signUp(page, name, email);
  await verifyEmail(email);
  await page.getByRole("button", { name: "Já confirmei" }).click();
  await expect(page).toHaveURL(/\/criar-familia$/);
  await page.getByLabel("Nome da família").fill(family);
  await page.getByRole("button", { name: "Criar a família" }).click();
  await aceitarPrivacidade(page);
}

const familyList = (page: Page) => page.getByRole("list", { name: "Suas famílias" });

async function choose(page: Page, family: string) {
  await familyList(page).getByRole("button", { name: new RegExp(family) }).click();
  await aceitarPrivacidade(page);
}

test("Lote 5E-A: uma conta, várias famílias", async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: base, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
  const p = await other.newPage();

  await test.step("a pessoa já tem a própria família", async () => {
    await newOwner(p, "Paula Cuidadora", emailPessoa, "Família Paula ZZ");
    await expect(p.getByRole("link", { name: "Trocar de família" })).toHaveCount(0);
  });

  await test.step("outra família convida o mesmo e-mail", async () => {
    await newOwner(page, "Dora Dona", emailDono, "Família Dora ZZ");
    await open(page, "/configuracoes/pessoas");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nome", { exact: true }).fill("Paula Convidada");
    await dialog.getByRole("textbox", { name: "E-mail" }).fill(emailPessoa);
    await dialog.getByLabel("Perfil").selectOption("Cuidadora");
    await dialog.getByRole("button", { name: "Convidar" }).click();
    await expect(page.getByText("Paula Convidada").first()).toBeVisible();
  });

  await test.step("ela aceita com a MESMA senha (sem criar outra)", async () => {
    const res = await page.request.get(`/api/test/invite-link?email=${encodeURIComponent(emailPessoa)}`);
    expect(res.ok()).toBe(true);
    const { link } = (await res.json()) as { link: string };
    await open(p, link);
    await expect(p.getByText(/Família Dora ZZ com o perfil Cuidadora/)).toBeVisible();
    await expect(p.getByLabel("Crie uma senha")).toHaveCount(0);
    await p.getByRole("button", { name: "Aceitar convite" }).click();
    await aceitarPrivacidade(p);
    await expect(p.locator("aside").getByText("Família Dora ZZ")).toBeVisible();
  });

  await test.step("a aba antiga recarrega quando a família é trocada em outra aba", async () => {
    const secondTab = await other.newPage();
    await open(secondTab, "/escolher-familia");
    await choose(secondTab, "Família Paula ZZ");
    await expect(secondTab.locator("aside").getByText("Família Paula ZZ")).toBeVisible();
    await p.bringToFront();
    await p.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(p.locator("aside").getByText("Família Paula ZZ")).toBeVisible();
    await secondTab.close();
  });

  await test.step("trocar de família pelo menu: perfis diferentes em cada uma", async () => {
    await p.locator("aside").getByRole("link", { name: "Trocar de família" }).click();
    await expect(familyList(p).getByRole("button")).toHaveCount(2);
    await choose(p, "Família Dora ZZ");
    await open(p, "/conta");
    await expect(p.getByRole("region", { name: "Dados da conta" })).toContainText("Cuidadora");
    await expect(p.getByRole("region", { name: "Dados da conta" })).toContainText("Família Dora ZZ");
  });

  await test.step("no celular o nome da família fica visível e leva à troca", async () => {
    await p.setViewportSize({ width: 375, height: 812 });
    await open(p, "/");
    await expect(p.getByRole("link", { name: /Família Dora ZZ.*Trocar/ })).toBeVisible();
    await p.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("criar mais uma família a partir de Minha conta", async () => {
    await open(p, "/conta");
    await p.getByRole("link", { name: "Criar outra família" }).click();
    await expect(p.getByRole("heading", { name: "Nova família" })).toBeVisible();
    await p.locator("body[data-hydrated]").waitFor({ state: "attached" });
    await p.getByLabel("Nome da família").fill("Família Terceira ZZ");
    await p.getByRole("button", { name: "Criar a família" }).click();
    await aceitarPrivacidade(p);
    await expect(p.locator("aside").getByText("Família Terceira ZZ")).toBeVisible();
  });

  await test.step("sair e entrar de novo lembra a última família", async () => {
    await open(p, "/conta");
    await p.locator("#conteudo").getByRole("button", { name: "Sair" }).click();
    await expect(p).toHaveURL(/\/login$/);
    await p.getByLabel("E-mail").fill(emailPessoa);
    await p.getByLabel("Senha", { exact: true }).fill(PASSWORD);
    await p.getByRole("button", { name: "Entrar" }).click();
    await expect(p.locator("aside").getByText("Família Terceira ZZ")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("desativada na família da Dora, ela segue nas próprias", async () => {
    await open(page, "/configuracoes/pessoas");
    await page.getByRole("button", { name: "Desativar Paula Convidada" }).click();
    await page.getByRole("button", { name: "Desativar pessoa" }).click();
    await expect(page.getByText("Paula Convidada foi desativada(o)").first()).toBeVisible();
    await open(p, "/escolher-familia");
    await expect(familyList(p).getByRole("button")).toHaveCount(2);
    await expect(familyList(p)).not.toContainText("Família Dora ZZ");
    await choose(p, "Família Paula ZZ");
  });

  await other.close();
});
