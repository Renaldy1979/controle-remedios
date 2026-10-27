import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { PASSWORD, PREFIX, cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Roteiro do Lote 4A de ponta a ponta (docs/lotes/L4A-roteiro.md), SEM número real:
 * cadastrar o número → ele não é atendido enquanto pendente → verificar pelo simulador → fila de lembretes →
 * "tomei" baixa o estoque → "estoque" → chave de API → convite por WhatsApp → primeiro acesso → ativo.
 * Apaga tudo o que criou (usuários `zz-test-*` do Appwrite, famílias e chaves do Postgres).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const emailA = testEmail("l4a-admin");
const emailRosa = testEmail("l4a-rosa");
const phone = () => `5599${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const meuTel = phone();
const telRosa = phone();

test.beforeAll(async () => {
  await cleanup();
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();
const quantity = (page: Page) => page.getByTestId("stock-quantity").first();

/** Horário local (America/Sao_Paulo) de 10 minutos atrás, para a dose já estar na hora. */
function dezMinutosAtras(): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")!.value) % 24;
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  const total = Math.max(0, h * 60 + m - 10);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

async function falar(page: Page, texto: string) {
  await page.getByLabel("Mensagem", { exact: true }).fill(texto);
  await page.getByRole("button", { name: "Enviar" }).click();
}
const conversa = (page: Page) => page.getByRole("log", { name: "Mensagens" });

test("Lote 4A: número, simulador, tomei, estoque, chave de API, convite por WhatsApp e primeiro acesso", async ({ page, browser }) => {
  await test.step("conta, família, paciente, remédio (10 comprimidos) e esquema de 1 dose por dia, na hora", async () => {
    await signUp(page, "Ana Souza", emailA);
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await page.getByLabel("Nome da família").fill("Família L4A ZZ");
    await page.getByRole("button", { name: "Criar a família" }).click();
    await expect(page).toHaveURL(/\/$/);

    await open(page, "/configuracoes/pacientes");
    await page.getByRole("button", { name: "Cadastrar paciente" }).first().click();
    await page.getByLabel("Nome completo").fill("Adelino Souza");
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await toast(page, "Adelino Souza cadastrado");

    await open(page, "/configuracoes/remedios");
    await page.getByRole("button", { name: "Novo remédio" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Nome do remédio").fill("Zypred");
    await d.getByLabel("Tipo de uso").selectOption("Comprimido");
    await d.getByLabel("Unidade de controle").selectOption("Unidade");
    await d.getByLabel(/Estoque inicial/).fill("10");
    await d.getByRole("button", { name: "Cadastrar" }).click();
    await toast(page, "Zypred cadastrado");

    await open(page, "/configuracoes/esquemas");
    await page.getByLabel("Hora da primeira dose").fill(dezMinutosAtras());
    await page.getByRole("button", { name: "Salvar esquema" }).click();
    await toast(page, "Esquema de Zypred salvo");
  });

  await test.step("1) cadastrar o número: fica pendente e o portal mostra o código de 6 dígitos", async () => {
    await open(page, "/configuracoes/whatsapp");
    await expect(page.getByRole("heading", { name: "WhatsApp", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Não informado")).toBeVisible();
    await page.getByLabel("Celular com DDD").fill(meuTel);
    await page.getByRole("button", { name: "Gerar código" }).click();
    await expect(page.getByText("Pendente de validação").first()).toBeVisible();
    await expect(page.getByText(/pelo WhatsApp do número/)).toBeVisible();
    await page.screenshot({ path: "test-results/l4a-whatsapp-desktop.png", fullPage: true });
  });
  const codigo = await page.getByRole("status").filter({ hasText: "Envie este código" }).locator("p[aria-label^='Código']").innerText();
  expect(codigo).toMatch(/^\d{6}$/);

  await test.step("3) enquanto pendente, o simulador não é atendido (resposta genérica)", async () => {
    await open(page, "/configuracoes/simulador");
    await expect(page.getByText("Simulador: nenhuma mensagem real é enviada")).toBeVisible();
    await falar(page, "tomei");
    await expect(conversa(page).getByText("Não consegui te identificar por aqui")).toBeVisible();
  });

  await test.step("2) enviar o código no simulador: o número fica verificado", async () => {
    await falar(page, `CÓDIGO ${codigo}`);
    await expect(conversa(page).getByText("Número verificado")).toBeVisible();
    await page.screenshot({ path: "test-results/l4a-simulador-desktop.png", fullPage: true });
    await open(page, "/configuracoes/whatsapp");
    await expect(page.getByRole("region", { name: "Meu número de WhatsApp" })).toContainText("Verificado");
  });

  await test.step("6) a fila mostra o lembrete da dose; marcar como enviada o põe na conversa", async () => {
    await open(page, "/configuracoes/simulador");
    await page.getByRole("button", { name: "Atualizar" }).click();
    const fila = page.getByRole("complementary", { name: "Mensagens que o sistema enviaria agora" });
    await expect(fila.getByText(/Hora do remédio — Adelino/)).toBeVisible();
    await fila.getByRole("button", { name: "Marcar como enviada" }).first().click();
    await expect(conversa(page).getByText(/Hora do remédio — Adelino/)).toBeVisible();
    await expect(conversa(page).getByText("Tomei")).toBeVisible();
  });

  await test.step("4) '1' (Tomei) confirma a dose e o estoque cai de 10 para 9; a mesma dose não baixa de novo", async () => {
    await falar(page, "1");
    await expect(conversa(page).getByText("Anotado")).toBeVisible();
    await open(page, "/pacientes");
    await expect(quantity(page)).toHaveAttribute("data-quantity", "9");
    await open(page, "/configuracoes/simulador");
    await falar(page, "tomei");
    await expect(conversa(page).getByText("Nenhuma dose pendente").last()).toBeVisible();
    await open(page, "/pacientes");
    await expect(quantity(page)).toHaveAttribute("data-quantity", "9");
  });

  await test.step("5) 'estoque' e 'próximas doses'; texto livre sem a chave da IA avisa que o assistente está indisponível", async () => {
    await open(page, "/configuracoes/simulador");
    await falar(page, "estoque");
    await expect(conversa(page).getByText(/Adelino — Zypred/)).toBeVisible();
    await falar(page, "próximas doses");
    await expect(conversa(page).getByText("Próximas doses")).toBeVisible();
    await falar(page, "qual a melhor dieta para diabetes?");
    await expect(conversa(page).getByText(/assistente de perguntas está indisponível/)).toBeVisible();
  });

  await test.step("8) criar e revogar uma chave de API (o valor aparece uma vez)", async () => {
    await open(page, "/configuracoes/whatsapp");
    await page.getByLabel("Nome da nova chave").first().fill("zz-test planilha");
    await page.getByRole("button", { name: "Criar chave" }).first().click();
    const alerta = page.getByRole("alert").filter({ hasText: "Copie agora" });
    await expect(alerta).toBeVisible();
    const chave = (await alerta.locator("code").innerText()).trim();
    expect(chave).toMatch(/^cdf_/);
    await page.getByRole("button", { name: "Já copiei" }).click();
    await expect(page.getByText("zz-test planilha")).toBeVisible();
    // a chave funciona na API (com o número verificado) e some da tela
    const r = await page.request.get("/api/v1/doses/proximas", { headers: { authorization: `Bearer ${chave}`, "x-telefone": meuTel } });
    expect(r.status()).toBe(200);
    await open(page, "/configuracoes/whatsapp");
    expect(await page.content()).not.toContain(chave);
    await page.getByRole("button", { name: "Revogar" }).first().click();
    await expect(page.getByText("Revogada").first()).toBeVisible();
    const r2 = await page.request.get("/api/v1/doses/proximas", { headers: { authorization: `Bearer ${chave}`, "x-telefone": meuTel } });
    expect(r2.status()).toBe(401);
    const doc = await page.request.get("/api/v1/openapi.json");
    expect(doc.status()).toBe(200);
    expect(JSON.stringify(await doc.json())).toContain("/conversa/mensagem");
  });

  await test.step("capturas: WhatsApp e simulador em 390 e 1280 px, claro e escuro", async () => {
    for (const [w, h, cor] of [[1280, 900, "light"], [1280, 900, "dark"], [390, 844, "light"], [390, 844, "dark"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: cor });
      for (const [rota, nome] of [["/configuracoes/whatsapp", "whatsapp"], ["/configuracoes/simulador", "simulador"]] as const) {
        await open(page, rota);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `test-results/visual-${nome}-${w}-${cor}.png`, fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
  });

  let codigoConvite = "";
  await test.step("7) convite por WhatsApp: o admin gera o código para o número esperado", async () => {
    await open(page, "/configuracoes/pessoas");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    await page.getByText("Por código de WhatsApp").click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Nome", { exact: true }).fill(`${PREFIX}Rosa`);
    await d.getByLabel(/Celular com DDD/).fill(telRosa);
    await d.getByLabel("Perfil").selectOption("Familiar");
    await d.getByRole("button", { name: "Gerar código" }).click();
    codigoConvite = (await d.locator(".num").first().innerText()).trim();
    expect(codigoConvite).toMatch(/^\d{6}$/);
    await page.getByRole("button", { name: "Entendi" }).click();
  });

  let linkPrimeiroAcesso = "";
  await test.step("7) o convidado envia o código DO NÚMERO ESPERADO pelo simulador e recebe o link de primeiro acesso", async () => {
    await open(page, "/configuracoes/simulador");
    await page.getByLabel("Falar como").selectOption("novo");
    await page.getByLabel("Número do remetente").fill(phone()); // outro número com o código certo: não entra
    await falar(page, codigoConvite);
    await expect(conversa(page).getByText("Código inválido")).toBeVisible();
    await page.getByLabel("Número do remetente").fill(telRosa);
    await falar(page, codigoConvite);
    await expect(conversa(page).getByText(/Bem-vindo\(a\), zz-test-Rosa/)).toBeVisible();
    const texto = await conversa(page).getByText(/primeiro-acesso\?t=/).first().innerText();
    linkPrimeiroAcesso = /https?:\/\/\S+\/primeiro-acesso\?t=[\w-]+/.exec(texto)![0];
    // com o número verificado a pessoa já dá o check (permissões básicas)
    await falar(page, "estoque");
    await expect(conversa(page).getByText(/Estoque/).last()).toBeVisible();
  });

  await test.step("7) primeiro acesso: define e-mail e senha, confirma o e-mail e vira ativa (o link vale uma vez)", async () => {
    const ctx = await browser.newContext({ baseURL: page.url().split("/").slice(0, 3).join("/"), locale: "pt-BR", viewport: { width: 1280, height: 900 } });
    const rosa = await ctx.newPage();
    const url = new URL(linkPrimeiroAcesso);
    await open(rosa, `${url.pathname}${url.search}`);
    await expect(rosa.getByRole("heading", { name: "Primeiro acesso" })).toBeVisible();
    // falha rápido e com a causa à vista (o título "Primeiro acesso" também aparece no aviso de link inválido)
    await expect(rosa.getByText("Este link não vale mais"), `link capturado inválido: ${linkPrimeiroAcesso}`).toHaveCount(0);
    await expect(rosa.getByLabel("Seu e-mail")).toBeVisible();
    for (const [w, h, cor] of [[1280, 900, "light"], [1280, 900, "dark"], [390, 844, "light"], [390, 844, "dark"]] as const) {
      await rosa.setViewportSize({ width: w, height: h });
      await rosa.emulateMedia({ colorScheme: cor });
      await open(rosa, `${url.pathname}${url.search}`); // o tema é lido ao carregar
      await rosa.waitForTimeout(400);
      await rosa.screenshot({ path: `test-results/visual-primeiro-acesso-${w}-${cor}.png`, fullPage: true });
    }
    await rosa.setViewportSize({ width: 1280, height: 900 });
    await rosa.emulateMedia({ colorScheme: "light" });
    await expect(rosa.getByText("Este link não vale mais")).toHaveCount(0); // abrir a página nunca gasta o link
    await rosa.getByLabel("Seu e-mail").fill(emailRosa);
    await rosa.getByLabel("Crie uma senha").fill(PASSWORD);
    await rosa.getByLabel("Repita a senha").fill(PASSWORD);
    await rosa.getByRole("button", { name: "Criar meu acesso" }).click();
    await expect(rosa).toHaveURL(/\/verificar-email$/);
    await verifyEmail(emailRosa);
    await rosa.getByRole("button", { name: "Já confirmei" }).click();
    await expect(rosa).toHaveURL(/\/$/); // ativa: entra no portal da família
    // o link de uso único não vale mais
    await open(rosa, `${url.pathname}${url.search}`);
    await expect(rosa.getByText("Este link não vale mais")).toBeVisible();
    await ctx.close();

    const sql = postgres(process.env["DATABASE_URL_ADMIN"] ?? "postgres://medcuidar_owner:medcuidar_owner_dev@localhost:5440/medcuidar", { max: 1, onnotice: () => {} });
    try {
      const [m] = await sql`select access_state, phone_verified, email_confirmed_at from members where email = ${emailRosa.toLowerCase()}`;
      expect(m?.["access_state"]).toBe("active");
      expect(m?.["phone_verified"]).toBe(telRosa);
      expect(m?.["email_confirmed_at"]).toBeTruthy();
    } finally {
      await sql.end({ timeout: 2 });
    }
  });
});
