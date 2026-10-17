import { expect, test } from "@playwright/test";
import { AUTH, PHONE, login, open } from "./helpers";

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test.describe("sem sessão", () => {
test.use({ storageState: { cookies: [], origins: [] } });
test("sem sessão, o painel manda para o login e a API recusa", async ({ page, request }) => {
  await page.goto("/pacientes");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/rx-file/qualquer")).status()).toBe(401);
});
});

test.describe("login", () => {
test.use({ storageState: { cookies: [], origins: [] } });
test("login com código lido do canal falso abre o início da família", async ({ page }) => {
  await login(page, PHONE.claudia);
  await expect(page.getByText(/^(Bom dia|Boa tarde|Boa noite), Cláudia$/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Receitas" }).first()).toBeVisible();
});

test("Sair apaga a sessão no Appwrite (o cookie antigo não volta a valer)", async ({ page, context }) => {
  await login(page, PHONE.claudia);
  const old = (await context.cookies()).find((c) => c.name === "mc_session");
  expect(old?.httpOnly).toBe(true);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  // devolve o cookie antigo: se a sessão ainda existisse no Appwrite, o painel abriria
  await context.addCookies([old!]);
  await open(page, "/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Celular com DDD")).toBeVisible();
});

test("código errado não entra", async ({ page }) => {
  await open(page, "/login");
  await page.getByLabel("Celular com DDD").fill(PHONE.lucas);
  await page.getByRole("button", { name: "Receber código" }).click();
  await page.getByLabel("Código de 6 números").fill("000000");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/não confere/)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
});

test.describe("com sessão da Ana", () => {
test.use({ storageState: AUTH.ana });
test("confirmar dose reduz o estoque e Desfazer devolve", async ({ page }) => {
  await open(page, "/");
  // primeira dose que ainda não foi tomada (atrasada/esquecida/pendente) na tela inicial
  const card = page.locator("article[aria-label]").filter({ has: page.getByRole("button", { name: /Confirmar dose|Registrar que tomou depois/ }) }).first();
  await expect(card).toBeVisible();
  const label = (await card.getAttribute("aria-label"))!; // "Med, Paciente, 08:00, Estado"
  const [med, patient] = label.split(", ") as [string, string];

  const stockOf = async () => {
    await page.getByRole("link", { name: "Pacientes" }).first().click();
    await page.getByRole("tab", { name: new RegExp(patient) }).click();
    const art = page.locator("article").filter({ has: page.getByRole("heading", { name: med }) }).first();
    await expect(art).toBeVisible();
    return Number(await art.getByTestId("stock-quantity").getAttribute("data-quantity"));
  };
  const before = await stockOf();
  await page.getByRole("link", { name: "Início" }).first().click();
  await card.getByRole("button", { name: /Confirmar dose|Registrar que tomou depois/ }).click();
  await expect(page.getByText(/confirmada/).first()).toBeVisible();
  const after = await stockOf();
  expect(after).toBeLessThan(before);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect.poll(stockOf, { timeout: 30_000 }).toBe(before);
});

});

test.describe("com sessão do Seu João", () => {
test.use({ storageState: AUTH.joao });
test("Seu João (Confirmador) não vê receitas e a API de arquivos recusa", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByRole("link", { name: "Receitas" })).toHaveCount(0);
  await open(page, "/receitas");
  await expect(page.getByText("Esta área não está liberada")).toBeVisible();
  expect((await page.request.get("/api/rx-file/qualquer?v=thumb&exp=1&m=x&sig=y")).status()).toBe(403);
});

});

test.describe("receitas da Ana", () => {
test.use({ storageState: AUTH.ana });
// a receita de teste é só excluída pela tela (exclusão lógica); aqui some de vez, junto com a imagem
test.afterAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: `http://localhost:${process.env["E2E_PORT"] ?? 3100}` });
  await api.post("/api/test/purge-deleted-rx");
  await api.dispose();
});
test("anexar receita em 3 passos, ver o detalhe e excluir", async ({ page }) => {
  await open(page, "/");
  await page.getByRole("link", { name: "Receitas" }).first().click();
  await expect(page).toHaveURL(/\/receitas$/); // a tela inicial também tem "Anexar receita" (com remédio pré-escolhido)
  await page.getByRole("button", { name: "Anexar receita" }).click();
  await expect(page.getByRole("dialog", { name: "Anexar receita" })).toBeVisible();
  await page.locator('input[type="file"][multiple]').first().setInputFiles({ name: "receita.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Passo 2 de 3")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Passo 3 de 3")).toBeVisible();
  await page.getByRole("button", { name: "Losartana 50 mg" }).click();
  await page.getByRole("button", { name: "Salvar receita" }).click();
  await expect(page.getByRole("heading", { name: "Receita salva" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Ver receita" }).click();
  await expect(page.getByRole("heading", { name: /Receita de Losartana/ })).toBeVisible();
  // limpeza: a receita de teste é excluída (exclusão lógica + auditoria)
  await page.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("button", { name: "Excluir receita" }).click();
  await expect(page).toHaveURL(/\/receitas$/);
});
});
