import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, cleanup, open, signIn, signUp, testEmail, verifyEmail } from "./support";

/**
 * Roteiro do Lote 1 de ponta a ponta (docs/lotes/L1-roteiro.md): criar conta → confirmar e-mail → criar a família →
 * convidar (e-mail e WhatsApp) → perfis → cadastrar paciente/remédio/esquema → desativar → segunda família isolada.
 * Roda no Postgres local e no Appwrite do .env (só Auth). Apaga tudo o que criou, passe ou falhe.
 */
test.describe.configure({ mode: "serial" });

const emailA = testEmail("admin");
const emailB = testEmail("filha");
const emailC = testEmail("outra-familia");

test.beforeAll(async () => {
  await cleanup(); // sobras de uma execução interrompida
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

test("Lote 1: do cadastro à segunda família isolada", async ({ page, browser }) => {
  // ---- 1) criar conta e confirmar o e-mail ----
  await test.step("criar conta (e-mail e senha) e cair na tela de confirmar e-mail", async () => {
    await signUp(page, "Ana Souza", emailA);
  });

  await test.step("sem confirmar o e-mail não dá para criar a família", async () => {
    await page.goto("/criar-familia");
    await expect(page).toHaveURL(/\/verificar-email$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/verificar-email$/);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await expect(page.getByText("Ainda não vimos a confirmação")).toBeVisible();
  });

  await test.step("confirmar o e-mail libera a primeira entrada", async () => {
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await expect(page).toHaveURL(/\/criar-familia$/);
  });

  // ---- 2) família e administrador ----
  await test.step("criar a família e entrar como Administradora", async () => {
    await page.getByLabel("Nome da família").fill("Família Souza ZZ");
    await page.getByRole("button", { name: "Criar a família" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Primeiros passos" })).toBeVisible();
    await expect(page.getByText("Cadastre um remédio com estoque e esquema e as doses do dia aparecem aqui.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Configurações" })).toBeVisible();
  });

  await test.step("sair e entrar de novo; senha errada mostra erro claro", async () => {
    await open(page, "/conta");
    await page.locator("#conteudo").getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, emailA, "senha-errada-1");
    await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
    await signIn(page, emailA);
    await expect(page).toHaveURL(/\/$/);
  });

  // ---- 3) WhatsApp pendente ----
  await test.step("o número de WhatsApp fica pendente (e o portal segue funcionando)", async () => {
    await open(page, "/conta");
    await expect(page.getByText("Não informado")).toBeVisible();
    await page.getByLabel("Celular com DDD").fill("(11) 91234-5678");
    await page.getByRole("button", { name: "Salvar número" }).click();
    await expect(page.getByText("Pendente de validação").first()).toBeVisible();
    await expect(page.getByText("A validação chega no Lote 4.")).toBeVisible();
  });

  // ---- 4) pacientes, remédios e esquemas ----
  await test.step("cadastrar Adelino e Maria", async () => {
    await open(page, "/configuracoes/pacientes");
    await expect(page.getByText("Nenhum paciente ainda")).toBeVisible();
    await page.getByRole("button", { name: "Cadastrar paciente" }).first().click();
    await page.getByLabel("Nome completo").fill("Adelino Souza");
    await page.getByLabel("Data de nascimento").fill("10/03/1942");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await toast(page, "Adelino Souza cadastrado");

    await page.getByRole("button", { name: "Cadastrar paciente" }).first().click();
    await page.getByLabel("Nome completo").fill("Maria Souza");
    await page.getByLabel("Observações").fill("Alzheimer. Não usa celular.");
    await page.getByRole("dialog").getByText("Usa celular", { exact: true }).click(); // desmarca
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await toast(page, "Maria Souza cadastrado");
    await expect(page.getByText("Sem celular").first()).toBeVisible();
  });

  await test.step("cadastrar o Zypred (marcas, via, unidade, gotas por ml)", async () => {
    await open(page, "/configuracoes/remedios");
    await page.getByRole("button", { name: "Novo remédio" }).click();
    await page.getByRole("dialog").getByLabel("Paciente", { exact: true }).selectOption({ label: "Maria Souza" });
    await page.getByRole("dialog").getByLabel("Nome do remédio").fill("Zypred");
    await page.getByRole("dialog").getByLabel("Marcas alternativas").fill("Facoba, Vigadexa");
    await page.getByRole("dialog").getByLabel("Tipo de uso").selectOption("Pingar");
    await page.getByRole("dialog").getByLabel("Unidade de controle").selectOption("Gotas");
    await expect(page.getByRole("dialog").getByLabel("Gotas por ml")).toHaveValue("20");
    await page.getByRole("dialog").getByRole("button", { name: "Cadastrar" }).click();
    await toast(page, "Zypred cadastrado");
    await expect(page.getByRole("button", { name: "Remover marca Facoba" })).toBeVisible();
  });

  await test.step("esquema com duas fases: 3 em 3 h por 15 dias, depois 6 em 6 h", async () => {
    await open(page, "/configuracoes/esquemas");
    await page.getByRole("switch", { name: /Fase única/ }).click(); // desliga a fase única
    await page.getByRole("button", { name: "Adicionar fase" }).click();
    // fase 2 (selecionada ao adicionar): 6 em 6 h
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Diminuir horas entre as doses" }).click(); // 24 -> 12 -> 8 -> 6
    await page.getByRole("button", { name: "Fase 1" }).click();
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Diminuir horas entre as doses" }).click(); // 24 -> ... -> 3
    await page.getByLabel("Quantos dias dura esta fase").fill("15");
    await page.getByRole("button", { name: "Salvar esquema" }).click();
    await toast(page, "Esquema de Zypred salvo");

    await open(page, "/pacientes");
    await page.getByRole("tab", { name: "Maria" }).click();
    await expect(page.getByText(/Maria Souza/).first()).toBeVisible();
    await expect(page.getByText("Zypred", { exact: true })).toBeVisible();
    await expect(page.getByText(/Fase 1 de 2 · dia 1/)).toBeVisible();
    await expect(page.getByText("de 3 em 3 h")).toBeVisible();
  });

  await test.step("fases com buraco são recusadas com mensagem clara", async () => {
    await open(page, "/configuracoes/esquemas");
    await page.getByLabel("Quantos dias dura esta fase").fill("0");
    await page.getByRole("button", { name: "Salvar esquema" }).click();
    await expect(page.getByRole("alert").getByText(/duração precisa ser um número de dias/)).toBeVisible();
  });

  // ---- 5) convites ----
  await test.step("convidar uma filha por e-mail", async () => {
    await open(page, "/configuracoes/usuarios");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    await page.getByRole("dialog").getByLabel("Nome", { exact: true }).fill("Filha Teste");
    await page.getByRole("dialog").getByRole("textbox", { name: "E-mail" }).fill(emailB);
    await page.getByRole("dialog").getByLabel("Perfil").selectOption("Familiar");
    await page.getByRole("dialog").getByRole("button", { name: "Convidar" }).click();
    await expect(page.getByRole("dialog").getByText("Convite enviado a Filha Teste")).toBeVisible();
    await page.getByRole("button", { name: "Entendi" }).click();
    await expect(page.getByText("Convite pendente").first()).toBeVisible();
  });

  const daughter = await browser.newContext({ baseURL: `http://localhost:${process.env["E2E_PORT"] ?? 3100}`, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
  const dp = await daughter.newPage();
  await test.step("a filha abre o link, cria a senha e entra com o perfil escolhido", async () => {
    const res = await page.request.get(`/api/test/invite-link?email=${encodeURIComponent(emailB)}`);
    expect(res.ok()).toBe(true);
    const { link } = (await res.json()) as { link: string };
    await dp.goto(link);
    await dp.locator("body[data-hydrated]").waitFor({ state: "attached" });
    await expect(dp.getByText(/convidado\(a\) para a Família Souza ZZ com o perfil Familiar/)).toBeVisible();
    await dp.getByLabel("Crie uma senha").fill(PASSWORD);
    await dp.getByLabel("Repita a senha").fill(PASSWORD);
    await dp.getByRole("button", { name: "Criar senha e entrar" }).click();
    await expect(dp).toHaveURL(/\/$/);
    await expect(dp.getByText(/(Olá|Bom dia|Boa tarde|Boa noite), Filha Teste/)).toBeVisible();
    // o link é de uso único
    const again = await daughter.newPage();
    await again.goto(link);
    await expect(again.getByText("Este convite não vale mais")).toBeVisible();
    await again.close();
  });

  await test.step("trocar o perfil dela para Confirmador: ela deixa de ver Configurações", async () => {
    await open(page, "/configuracoes/usuarios");
    await expect(page.getByText("Filha Teste")).toBeVisible();
    await page.getByRole("button", { name: "Editar Filha Teste" }).click();
    await page.getByRole("dialog").getByLabel("Perfil").selectOption("Confirmador");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await toast(page, "Filha Teste atualizada");

    await dp.reload();
    await expect(dp.getByText(/(Olá|Bom dia|Boa tarde|Boa noite), Filha Teste/)).toBeVisible();
    await expect(dp.getByRole("link", { name: "Configurações" })).toHaveCount(0);
    await dp.goto("/configuracoes");
    await expect(dp.getByText("Seu perfil não tem ajustes liberados.")).toBeVisible();
    await dp.goto("/configuracoes/usuarios");
    await expect(dp.getByRole("button", { name: "Convidar pessoa" })).toHaveCount(0);
  });

  await test.step("convite por WhatsApp: o código aparece UMA vez e fica guardado só como hash", async () => {
    await open(page, "/configuracoes/usuarios");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    await page.getByText("Por código de WhatsApp").click();
    await page.getByRole("dialog").getByLabel("Nome", { exact: true }).fill("Dona Zélia");
    await page.getByRole("dialog").getByLabel(/Celular com DDD/).fill("(99) 98888-7777");
    await page.getByRole("dialog").getByLabel("Perfil").selectOption("Cuidadora");
    await page.getByRole("dialog").getByRole("button", { name: "Gerar código" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("O uso do código pelo WhatsApp chega no Lote 4.")).toBeVisible();
    await expect(dialog.getByText("aparece só uma vez")).toBeVisible();
    const code = (await dialog.locator(".num").first().innerText()).trim();
    expect(code).toMatch(/^\d{6}$/);
    await page.getByRole("button", { name: "Entendi" }).click();
    await expect(page.getByText("Dona Zélia")).toBeVisible();
    await expect(page.getByText("Convite por WhatsApp · vale até")).toBeVisible();
    for (const p of ["/configuracoes/usuarios", "/"]) {
      await open(page, p);
      expect(await page.content()).not.toContain(code);
    }
  });

  await test.step("desativar a filha derruba a sessão dela na hora", async () => {
    await open(page, "/configuracoes/usuarios");
    await page.getByRole("button", { name: "Desativar Filha Teste" }).click();
    await page.getByRole("button", { name: "Desativar pessoa" }).click();
    await toast(page, "Filha Teste foi desativada(o)");
    await dp.goto("/");
    await expect(dp).toHaveURL(/\/login/);
    await signIn(dp, emailB);
    await expect(dp.getByText(/E-mail ou senha incorretos|desativado/)).toBeVisible();
    await daughter.close();

    // reativar devolve o acesso
    await page.getByRole("button", { name: "Reativar Filha Teste" }).click();
    await toast(page, "Filha Teste foi reativada(o)");
  });

  // ---- 6) segunda família isolada ----
  await test.step("uma segunda família, com outro e-mail, não vê nada da primeira", async () => {
    const other = await browser.newContext({ baseURL: `http://localhost:${process.env["E2E_PORT"] ?? 3100}`, locale: "pt-BR", viewport: { width: 1280, height: 900 } });
    const op = await other.newPage();
    await signUp(op, "Carla Lima", emailC);
    await verifyEmail(emailC);
    await op.getByRole("button", { name: "Já confirmei" }).click();
    await expect(op).toHaveURL(/\/criar-familia$/);
    await op.getByLabel("Nome da família").fill("Família Lima ZZ");
    await op.getByRole("button", { name: "Criar a família" }).click();
    await expect(op).toHaveURL(/\/$/);

    for (const path of ["/", "/pacientes", "/configuracoes/pacientes", "/configuracoes/remedios", "/configuracoes/esquemas", "/configuracoes/usuarios"]) {
      await open(op, path);
      const text = await op.locator("body").innerText();
      for (const secret of ["Adelino", "Maria", "Zypred", "Filha Teste", "Dona Zélia", "Ana Souza", "Família Souza"]) expect(text, `${path} vazou "${secret}"`).not.toContain(secret);
    }
    await open(op, "/pacientes");
    await expect(op.getByText("Nenhum paciente cadastrado")).toBeVisible();
    await open(op, "/configuracoes/usuarios");
    await expect(op.getByText("Carla Lima", { exact: true })).toBeVisible();
    await other.close();
  });
});
