import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Roteiro do Lote 2 de ponta a ponta (docs/lotes/L2-roteiro.md): cadastrar remédio com estoque e esquema → doses do dia →
 * confirmar (o estoque cai) → desfazer (o estoque volta) → cruzar o limite → o sino de OUTRO usuário avisa.
 * Roda no Postgres local e no Appwrite do .env (só Auth). Apaga tudo o que criou (usuários `zz-test-*` e famílias).
 */
test.describe.configure({ mode: "serial" });

const emailA = testEmail("l2-admin");
const emailB = testEmail("l2-filha");

test.beforeAll(async () => {
  await cleanup();
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();
const quantity = (page: Page) => page.getByTestId("stock-quantity").first();

test("Lote 2: doses do dia, check, baixa de estoque, desfazer e aviso no sino", async ({ page, browser }) => {
  await test.step("conta e família da administradora", async () => {
    await signUp(page, "Ana Souza", emailA);
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await expect(page).toHaveURL(/\/criar-familia$/);
    await page.getByLabel("Nome da família").fill("Família L2 ZZ");
    await page.getByRole("button", { name: "Criar a família" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  await test.step("cadastrar o paciente e um remédio com 60 comprimidos de estoque", async () => {
    await open(page, "/configuracoes/pacientes");
    await page.getByRole("button", { name: "Cadastrar paciente" }).first().click();
    await page.getByLabel("Nome completo").fill("Adelino Souza");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await toast(page, "Adelino Souza cadastrado");

    await open(page, "/configuracoes/remedios");
    await page.getByRole("button", { name: "Novo remédio" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Nome do remédio").fill("Losartana 50 mg");
    await d.getByLabel("Tipo de uso").selectOption("Comprimido");
    await d.getByLabel("Unidade de controle").selectOption("Unidade");
    await d.getByLabel(/Estoque inicial/).fill("60");
    await d.getByRole("button", { name: "Cadastrar" }).click();
    await toast(page, "Losartana 50 mg cadastrado");
  });

  await test.step("esquema de 8 em 8 horas a partir das 06:00 (3 doses por dia)", async () => {
    await open(page, "/configuracoes/esquemas");
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Diminuir horas entre as doses" }).click(); // 24 -> 12 -> 8
    await page.getByLabel("Primeiro horário do dia").fill("06:00");
    await page.getByRole("button", { name: "Salvar esquema" }).click();
    await toast(page, "Esquema de Losartana 50 mg salvo");
  });

  await test.step("as 3 doses do dia aparecem em Pacientes; o estoque é 60", async () => {
    await open(page, "/pacientes");
    const chips = page.getByRole("list", { name: "Horários de hoje" }).getByRole("listitem");
    await expect(chips).toHaveCount(3);
    await expect(page.getByText("0 de 3 doses tomadas hoje")).toBeVisible();
    await expect(quantity(page)).toHaveAttribute("data-quantity", "60");
    await expect(page.getByText("60 comprimidos")).toBeVisible();
  });

  const buttons = page.getByRole("list", { name: "Horários de hoje" }).getByRole("button");
  await test.step("confirmar 3 doses: o saldo cai a cada uma (60 → 57)", async () => {
    for (let i = 1; i <= 3; i++) {
      await buttons.first().click();
      await expect(quantity(page)).toHaveAttribute("data-quantity", String(60 - i));
    }
    await expect(page.getByText("3 de 3 doses tomadas hoje")).toBeVisible();
    await expect(buttons).toHaveCount(0);
    await expect(page.getByText("Ana Souza · ").first()).toBeVisible(); // quem deu e quando
  });

  await test.step("desfazer a última devolve ao estoque e a dose volta a esperar o check", async () => {
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect(quantity(page)).toHaveAttribute("data-quantity", "58");
    await expect(page.getByText("2 de 3 doses tomadas hoje")).toBeVisible();
    await expect(buttons).toHaveCount(1);
    // confirmar de novo desconta uma vez só
    await buttons.first().click();
    await expect(quantity(page)).toHaveAttribute("data-quantity", "57");
  });

  await test.step("Estoque em Configurações: movimentações e previsão", async () => {
    await open(page, "/configuracoes/estoque");
    await expect(page.getByRole("region", { name: "Estoque por urgência" }).getByText("57 comprimidos")).toBeVisible();
    await expect(page.getByText(/Dose tomada · Losartana 50 mg/).first()).toBeVisible();
    await expect(page.getByText(/Dose desfeita · Losartana 50 mg/).first()).toBeVisible();
    await expect(page.getByText(/Saldo inicial · Losartana 50 mg \+60/)).toBeVisible();
    await page.getByRole("form", { name: "Registrar compra" }).getByLabel(/Quantidade comprada/).fill("3");
    await expect(page.getByTestId("purchase-preview")).toBeVisible();
  });

  const filha = await browser.newContext({ baseURL: `http://localhost:${process.env["E2E_PORT"] ?? 3100}`, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
  const fp = await filha.newPage();
  await test.step("convidar a filha (Familiar) e ela entra", async () => {
    await open(page, "/configuracoes/usuarios");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    await page.getByRole("dialog").getByLabel("Nome", { exact: true }).fill("Filha Teste");
    await page.getByRole("dialog").getByRole("textbox", { name: "E-mail" }).fill(emailB);
    await page.getByRole("dialog").getByLabel("Perfil").selectOption("Familiar");
    await page.getByRole("dialog").getByRole("button", { name: "Convidar" }).click();
    await expect(page.getByRole("dialog").getByText("Convite enviado a Filha Teste")).toBeVisible();
    await page.getByRole("button", { name: "Entendi" }).click();

    const res = await page.request.get(`/api/test/invite-link?email=${encodeURIComponent(emailB)}`);
    const { link } = (await res.json()) as { link: string };
    await fp.goto(link);
    await fp.locator("body[data-hydrated]").waitFor({ state: "attached" });
    await fp.getByLabel("Crie uma senha").fill(PASSWORD);
    await fp.getByLabel("Repita a senha").fill(PASSWORD);
    await fp.getByRole("button", { name: "Criar senha e entrar" }).click();
    await expect(fp.getByText("Olá, Filha Teste")).toBeVisible();
    // sem aviso ainda: o sino está sem número
    await expect(fp.getByRole("link", { name: "Avisos: nenhum novo" }).first()).toBeVisible();
  });

  await test.step("baixar o estoque até o limite (ajuste para 12): o aviso aparece no sino das DUAS pessoas", async () => {
    await open(page, "/configuracoes/estoque");
    const aj = page.getByRole("form", { name: "Ajuste manual" });
    await aj.getByLabel(/Quanto tem agora/).fill("12");
    await aj.getByLabel(/Motivo/).fill("conferi a caixa");
    await aj.getByRole("button", { name: "Registrar ajuste" }).click();
    await toast(page, "Ajuste registrado");
    await expect(page.getByText("Crítico").first()).toBeVisible();
    await expect(page.getByTestId("bell-count").first()).toHaveText("1");

    await fp.reload();
    await expect(fp.getByTestId("bell-count").first()).toHaveText("1");
    await fp.getByRole("link", { name: "Avisos: 1 novo" }).first().click();
    await expect(fp).toHaveURL(/\/avisos$/);
    await expect(fp.getByText("Estoque baixo: Losartana 50 mg (Adelino)")).toBeVisible();
    await expect(fp.getByRole("article", { name: /^Não lido:/ })).toHaveCount(1);
  });

  await test.step("a administradora também tem o aviso (um só); marcar como lido é só de quem leu", async () => {
    await open(page, "/avisos");
    await expect(page.getByTestId("notices-summary")).toHaveText("1 aviso novo");
    await expect(page.getByRole("article")).toHaveCount(1);

    await fp.getByRole("button", { name: "Marcar como lido" }).click();
    await expect(fp.getByTestId("notices-summary")).toHaveText("Nenhum aviso novo.");
    await expect(fp.getByRole("link", { name: "Avisos: nenhum novo" }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("notices-summary")).toHaveText("1 aviso novo"); // o da administradora continua novo
  });

  await test.step("Histórico: quem deu, quando e o canal; filtro por situação", async () => {
    await open(page, "/historico");
    await expect(page.getByTestId("history-count")).toHaveText("3 registros");
    const row = page.getByRole("row", { name: /Losartana 50 mg/ }).first();
    await expect(row).toContainText("Ana Souza");
    await expect(row).toContainText("Painel");
    await page.getByRole("button", { name: "Esquecidas" }).click();
    await expect(page.getByTestId("history-count")).not.toHaveText("3 registros");
  });

  await test.step("a filha confere o histórico e o estoque (perfil Familiar)", async () => {
    await open(fp, "/historico");
    await expect(fp.getByTestId("history-count")).toHaveText("3 registros");
    await open(fp, "/configuracoes/estoque");
    await expect(fp.getByRole("form", { name: "Registrar compra" })).toBeVisible();
  });

  await filha.close();
});
