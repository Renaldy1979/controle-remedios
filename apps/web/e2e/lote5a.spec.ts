import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, PREFIX, cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Roteiro do Lote 5A de ponta a ponta (docs/lotes/L5A-roteiro.md), SEM número real: perfil "Somente leitura".
 * Convite por WhatsApp (código → número verificado → "tomei" recusado) e por e-mail (link → senha → entra), menu só de leitura,
 * telas sem botões de ação, rota direta e API recusadas, matriz de perfis com as linhas de ação travadas e a leitura de receitas
 * liberável. Apaga tudo o que criou (usuários `zz-test-*` do Appwrite e famílias do Postgres).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const emailA = testEmail("l5a-admin");
const emailLeitor = testEmail("l5a-leitor");
const phone = () => `5599${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const telLeitora = phone();
const PERFIL = "Somente leitura";

test.beforeAll(async () => {
  await cleanup();
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();
const baseURL = () => `http://localhost:${process.env["E2E_PORT"] ?? 3100}`;

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

async function capturas(page: Page, rotas: Array<[string, string]>, prefixo: string) {
  for (const [w, h, cor] of [[1280, 900, "light"], [1280, 900, "dark"], [390, 844, "light"], [390, 844, "dark"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ colorScheme: cor });
    for (const [rota, nome] of rotas) {
      await open(page, rota);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `test-results/visual-${prefixo}-${nome}-${w}-${cor}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

test("Lote 5A: perfil Somente leitura (convite, navegação, recusas, matriz e avisos)", async ({ page, browser }) => {
  let chave = "";
  let codigoConvite = "";
  let doseId = "";

  await test.step("conta, família, paciente, remédio (10 comprimidos), esquema na hora e chave de API", async () => {
    await signUp(page, "Ana Souza", emailA);
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await page.getByLabel("Nome da família").fill("Família L5A ZZ");
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

    await open(page, "/configuracoes/whatsapp");
    await page.getByLabel("Nome da nova chave").first().fill("zz-test leitura");
    await page.getByRole("button", { name: "Criar chave" }).first().click();
    const alerta = page.getByRole("alert").filter({ hasText: "Copie agora" });
    await expect(alerta).toBeVisible();
    chave = (await alerta.locator("code").innerText()).trim();
    await page.getByRole("button", { name: "Já copiei" }).click();
  });

  await test.step("1) matriz de perfis: a coluna 'Somente leitura' tem as linhas de ação travadas; ler receitas é liberável", async () => {
    await open(page, "/configuracoes/perfis");
    const tabela = page.getByRole("table", { name: "Permissões por perfil" });
    await expect(tabela.getByRole("columnheader", { name: PERFIL })).toBeVisible();
    // 7 linhas de ação travadas, com o texto (estado nunca só por cor)
    const travadas = tabela.locator('[aria-disabled="true"]');
    await expect(travadas).toHaveCount(7);
    await expect(travadas.first()).toContainText("ação: indisponível neste perfil");
    // não há botão para ligar uma permissão de ação nessa coluna
    await expect(tabela.getByRole("switch", { name: `Confirmar dose — ${PERFIL}` })).toHaveCount(0);
    await expect(tabela.getByRole("switch", { name: `Anexar receitas — ${PERFIL}` })).toHaveCount(0);
    // as linhas de leitura continuam editáveis: estoque/doses ligados, receitas desligadas por padrão
    await expect(tabela.getByRole("switch", { name: `Ver doses e estoque — ${PERFIL}` })).toHaveAttribute("aria-checked", "true");
    await expect(tabela.getByRole("switch", { name: `Ver receitas — ${PERFIL}` })).toHaveAttribute("aria-checked", "false");
    await expect(tabela.getByRole("switch", { name: `Consultar pelo WhatsApp — ${PERFIL}` })).toHaveAttribute("aria-checked", "true");
    await capturas(page, [["/configuracoes/perfis", "matriz"]], "l5a");
  });

  await test.step("2) convite por WhatsApp com o perfil Somente leitura", async () => {
    await open(page, "/configuracoes/pessoas");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    await page.getByText("Por código de WhatsApp").click();
    const d = page.getByRole("dialog");
    await expect(d.getByLabel("Perfil").locator("option", { hasText: PERFIL })).toHaveCount(1);
    await d.getByLabel("Nome", { exact: true }).fill(`${PREFIX}Leitora`);
    await d.getByLabel(/Celular com DDD/).fill(telLeitora);
    await d.getByLabel("Perfil").selectOption(PERFIL);
    await d.getByRole("button", { name: "Gerar código" }).click();
    codigoConvite = (await d.locator(".num").first().innerText()).trim();
    expect(codigoConvite).toMatch(/^\d{6}$/);
    await page.getByRole("button", { name: "Entendi" }).click();
  });

  await test.step("3) a convidada envia o código pelo simulador e, com o número verificado, 'tomei' é recusado: 'seu perfil não permite'", async () => {
    await open(page, "/configuracoes/simulador");
    await page.getByLabel("Falar como").selectOption("novo");
    await page.getByLabel("Número do remetente").fill(telLeitora);
    await falar(page, codigoConvite);
    await expect(conversa(page).getByText(/Bem-vindo\(a\), zz-test-Leitora/)).toBeVisible();
    await falar(page, "tomei");
    await expect(conversa(page).getByText(/Seu perfil não permite/).first()).toBeVisible();
    await falar(page, "eu cuido disso");
    await expect(conversa(page).getByText(/Seu perfil não permite/).nth(1)).toBeVisible();
    // PARAR continua permitido; ela ainda consulta o estoque
    await falar(page, "estoque");
    await expect(conversa(page).getByText(/Adelino — Zypred/)).toBeVisible();
    await falar(page, "PARAR");
    await expect(conversa(page).getByText(/avisos|Avisos/).last()).toBeVisible();
    await falar(page, "REATIVAR");
    // a dose segue aberta: nada foi confirmado
    await open(page, "/pacientes");
    await expect(page.getByTestId("stock-quantity").first()).toHaveAttribute("data-quantity", "10");
  });

  await test.step("4) a API recusa a escrita do número da leitora (403) e entrega a leitura (200)", async () => {
    const h = { authorization: `Bearer ${chave}`, "x-telefone": telLeitora };
    const proximas = await page.request.get("/api/v1/doses/proximas", { headers: h });
    expect(proximas.status()).toBe(200);
    doseId = ((await proximas.json()) as { dados: Array<{ id: string }> }).dados[0]!.id;
    for (const [rota, corpo] of [[`/api/v1/doses/${doseId}/confirmar`, {}], [`/api/v1/doses/${doseId}/lembrar-de-novo`, { minutos: 15 }]] as const) {
      const r = await page.request.post(rota, { headers: h, data: corpo });
      expect(r.status(), rota).toBe(403);
      expect(((await r.json()) as { erro: { codigo: string } }).erro.codigo).toBe("sem_permissao");
    }
    expect((await page.request.get("/api/v1/receitas", { headers: h })).status()).toBe(403);
    expect((await page.request.get("/api/v1/estoque", { headers: h })).status()).toBe(200);
  });

  await test.step("5) convite por e-mail com o perfil: a pessoa entra e vê só Início, Pacientes e Histórico", async () => {
    await open(page, "/configuracoes/pessoas");
    await page.getByRole("button", { name: "Convidar pessoa" }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("Nome", { exact: true }).fill(`${PREFIX}Sobrinho`);
    await d.getByRole("textbox", { name: "E-mail" }).fill(emailLeitor);
    await d.getByLabel("Perfil").selectOption(PERFIL);
    await d.getByRole("button", { name: "Convidar" }).click();
    await expect(d.getByText(`Convite enviado a ${PREFIX}Sobrinho`)).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Entendi" }).click();
    const res = await page.request.get(`/api/test/invite-link?email=${encodeURIComponent(emailLeitor)}`);
    const { link } = (await res.json()) as { link: string };

    const ctx = await browser.newContext({ baseURL: baseURL(), locale: "pt-BR", viewport: { width: 1280, height: 900 } });
    const leitor = await ctx.newPage();
    await leitor.goto(link);
    await leitor.locator("body[data-hydrated]").waitFor({ state: "attached" });
    await leitor.getByLabel("Crie uma senha").fill(PASSWORD);
    await leitor.getByLabel("Repita a senha").fill(PASSWORD);
    await leitor.getByRole("button", { name: "Criar senha e entrar" }).click();
    await expect(leitor.getByText(`Olá, ${PREFIX}Sobrinho`)).toBeVisible();

    const menu = leitor.getByRole("navigation", { name: "Principal" });
    await expect(menu.getByRole("link", { name: /Início/ })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Pacientes" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Histórico" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Receitas" })).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Ajustes" })).toHaveCount(0);

    // telas: nenhum botão de ação (ausentes, não só desabilitados)
    const acoes = /^(Tomei|Confirmar|Registrar compra|Registrar a compra|Ajustar estoque|Corrigir estoque|Eu cuido disso|Comprar|Anexar receita|Compartilhar|Excluir|Cadastrar|Novo|Convidar)/;
    for (const rota of ["/", "/pacientes", "/historico"]) {
      await open(leitor, rota);
      await expect(leitor.getByRole("button", { name: acoes }), `botões de ação em ${rota}`).toHaveCount(0);
      await expect(leitor.getByRole("link", { name: /Ver receita|Anexar receita/ }), `receitas em ${rota}`).toHaveCount(0);
    }
    await open(leitor, "/pacientes");
    await expect(leitor.getByTestId("stock-quantity").first()).toBeVisible(); // vê o estoque
    // rota direta de configurações e de receitas: sem acesso
    await open(leitor, "/configuracoes/perfis");
    await expect(leitor.getByRole("table", { name: "Permissões por perfil" })).toHaveCount(0);
    await open(leitor, "/configuracoes/pessoas");
    await expect(leitor.getByRole("button", { name: "Convidar pessoa" })).toHaveCount(0);
    await open(leitor, "/receitas");
    await expect(leitor.getByRole("button", { name: /Anexar receita/ })).toHaveCount(0);
    await expect(leitor.getByText(/Dra\.|Dr\./)).toHaveCount(0);
    // privacidade: o HTML da página não traz o número da outra pessoa nem a chave
    const html = await leitor.content();
    expect(html).not.toContain(telLeitora);
    expect(html).not.toContain(chave);
    expect(html).not.toContain(emailA.toLowerCase());

    await capturas(leitor, [["/", "inicio"], ["/pacientes", "pacientes"], ["/historico", "historico"]], "l5a-leitor");
    await ctx.close();
  });

  await test.step("6) o administrador libera SÓ a leitura de receitas para o perfil e a coluna continua travada nas ações", async () => {
    await open(page, "/configuracoes/perfis");
    const tabela = page.getByRole("table", { name: "Permissões por perfil" });
    await tabela.getByRole("switch", { name: `Ver receitas — ${PERFIL}` }).click();
    await expect(tabela.getByRole("switch", { name: `Ver receitas — ${PERFIL}` })).toHaveAttribute("aria-checked", "true");
    await open(page, "/configuracoes/perfis");
    await expect(tabela.getByRole("switch", { name: `Ver receitas — ${PERFIL}` })).toHaveAttribute("aria-checked", "true");
    await expect(tabela.locator('[aria-disabled="true"]')).toHaveCount(7);
    // volta ao padrão
    await tabela.getByRole("switch", { name: `Ver receitas — ${PERFIL}` }).click();
    await expect(tabela.getByRole("switch", { name: `Ver receitas — ${PERFIL}` })).toHaveAttribute("aria-checked", "false");
  });
});
