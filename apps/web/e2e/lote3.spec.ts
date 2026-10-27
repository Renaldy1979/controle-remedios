import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PASSWORD, cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Roteiro do Lote 3 de ponta a ponta (docs/lotes/L3-roteiro.md): anexar receita (foto + PDF) → ver (visualizador, quem viu) →
 * compartilhar no portal → perfil sem permissão não vê e a rota de arquivo recusa → estoque cruza o limite → reposição →
 * assumir (e "assumir no lugar") → anexar a receita recebida → registrar a compra → estoque sobe → reposição encerrada.
 * Roda no Postgres local e no Appwrite do .env (só Auth). As páginas das receitas ficam na MEMÓRIA do servidor de teste
 * (RX_STORAGE=memory, só com E2E_TEST_MODE=1): o e2e não escreve no bucket do Appwrite; a ida real ao bucket é coberta por
 * `rx-storage.appwrite.test.ts` (bucket de teste dedicado, criado e apagado pelo teste). Apaga o que criou (`zz-test-*`).
 */
test.describe.configure({ mode: "serial" });

const emailA = testEmail("l3-admin");
const emailB = testEmail("l3-filha");
const emailC = testEmail("l3-neto");

test.beforeAll(async () => {
  await cleanup();
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();
const baseURL = () => `http://localhost:${process.env["E2E_PORT"] ?? 3100}`;

// JPEG de 1x1 pixel e um PDF mínimo
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
const jpg = (name: string) => ({ name, mimeType: "image/jpeg", buffer: JPEG });

async function inviteAndEnter(admin: Page, browser: Browser, name: string, email: string, profile: string): Promise<{ ctx: BrowserContext; page: Page }> {
  await open(admin, "/configuracoes/pessoas");
  await admin.getByRole("button", { name: "Convidar pessoa" }).click();
  await admin.getByRole("dialog").getByLabel("Nome", { exact: true }).fill(name);
  await admin.getByRole("dialog").getByRole("textbox", { name: "E-mail" }).fill(email);
  await admin.getByRole("dialog").getByLabel("Perfil").selectOption(profile);
  await admin.getByRole("dialog").getByRole("button", { name: "Convidar" }).click();
  await expect(admin.getByRole("dialog").getByText(`Convite enviado a ${name}`)).toBeVisible({ timeout: 90_000 }); // o Appwrite envia o e-mail de verdade: pode demorar
  await admin.getByRole("button", { name: "Entendi" }).click();
  const res = await admin.request.get(`/api/test/invite-link?email=${encodeURIComponent(email)}`);
  const { link } = (await res.json()) as { link: string };
  const ctx = await browser.newContext({ baseURL: baseURL(), locale: "pt-BR", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.locator("body[data-hydrated]").waitFor({ state: "attached" });
  await page.getByLabel("Crie uma senha").fill(PASSWORD);
  await page.getByLabel("Repita a senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar senha e entrar" }).click();
  await expect(page.getByText(`Olá, ${name}`)).toBeVisible();
  return { ctx, page };
}

/** Anexa uma receita pelo fluxo da tela: escolher páginas → continuar → remédio → salvar. */
async function attach(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  const dlg = page.getByRole("dialog", { name: "Anexar receita" });
  await expect(dlg).toBeVisible();
  await dlg.locator('input[type="file"][accept*="application/pdf"]').first().setInputFiles(files);
  await expect(dlg.getByText(`Página 1 de ${files.length}`)).toBeVisible();
  await dlg.getByRole("button", { name: "Continuar" }).click();
  await expect(dlg.getByText("Passo 3 de 3")).toBeVisible();
  const chip = dlg.getByRole("button", { name: "Losartana 50 mg" });
  if ((await chip.getAttribute("aria-pressed")) !== "true") await chip.click(); // pelo cartão da reposição o remédio já vem marcado
  await dlg.getByRole("button", { name: "Salvar receita" }).click();
  await expect(page.getByRole("dialog", { name: "Receita salva" })).toBeVisible();
}

test("Lote 3: receitas com fotos e PDF, compartilhar, permissões e reposição até o estoque subir", async ({ page, browser }) => {
  test.setTimeout(600_000); // dois convites com e-mail real do Appwrite + o roteiro inteiro
  await test.step("conta, família, paciente, remédio (exige receita, 60 comprimidos) e esquema de 8 em 8 h", async () => {
    await signUp(page, "Ana Souza", emailA);
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await expect(page).toHaveURL(/\/criar-familia$/);
    await page.getByLabel("Nome da família").fill("Família L3 ZZ");
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
    await d.getByLabel("Nome do remédio").fill("Losartana 50 mg");
    await d.getByLabel("Tipo de uso").selectOption("Comprimido");
    await d.getByLabel("Unidade de controle").selectOption("Unidade");
    await d.getByLabel(/Estoque inicial/).fill("60");
    await expect(d.getByLabel("Este remédio exige receita")).toBeChecked(); // padrão: exige
    await d.getByRole("button", { name: "Cadastrar" }).click();
    await toast(page, "Losartana 50 mg cadastrado");

    await open(page, "/configuracoes/esquemas");
    for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Diminuir horas entre as doses" }).click();
    await page.getByLabel("Hora da primeira dose").fill("06:00");
    await page.getByRole("button", { name: "Salvar esquema" }).click();
    await toast(page, "Esquema de Losartana 50 mg salvo");
  });

  let filha: { ctx: BrowserContext; page: Page };
  let neto: { ctx: BrowserContext; page: Page };
  await test.step("convidar a filha (Familiar) e o neto (Confirmador)", async () => {
    filha = await inviteAndEnter(page, browser, "Filha Teste", emailB, "Familiar");
    neto = await inviteAndEnter(page, browser, "Neto Teste", emailC, "Confirmador");
  });

  await test.step("Configurações em árvore: item expansível no menu, página e trilha por opção; no celular, índice e botão voltar", async () => {
    await open(page, "/configuracoes/remedios");
    const menu = page.getByRole("navigation", { name: "Principal" }).first();
    const toggle = menu.getByRole("button", { name: "Recolher as opções de Configurações" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true"); // dentro de uma opção, a árvore já vem aberta
    await expect(menu.getByRole("link", { name: "Remédios" })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Configurações" })).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Remédios", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Trilha de navegação" }).getByText("Remédios")).toHaveAttribute("aria-current", "page");
    await toggle.focus();
    await page.keyboard.press("Enter"); // teclado: Enter recolhe
    await expect(menu.getByRole("button", { name: "Mostrar as opções de Configurações" })).toHaveAttribute("aria-expanded", "false");
    await expect(menu.getByRole("link", { name: "Esquemas" })).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(menu.getByRole("link", { name: "Esquemas" })).toBeVisible();
    await menu.getByRole("link", { name: "Esquemas" }).click();
    await expect(page).toHaveURL(/\/configuracoes\/esquemas$/);
    await expect(page.getByRole("heading", { name: "Esquemas", level: 1 })).toBeVisible();
    await open(page, "/configuracoes/usuarios"); // endereço antigo segue funcionando
    await expect(page).toHaveURL(/\/configuracoes\/pessoas$/);
    await open(page, "/configuracoes");
    await expect(menu.getByRole("link", { name: "Configurações" })).toHaveAttribute("aria-current", "page");

    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/configuracoes");
    const lista = page.getByRole("navigation", { name: "Opções de Configurações" }).last();
    for (const nome of ["Remédios", "Esquemas", "Estoque", "Pacientes", "Pessoas", "Perfis", "Avisos"]) {
      const box = await lista.getByRole("link", { name: new RegExp(`^${nome}`) }).boundingBox();
      expect(box!.height, `${nome} deve ter alvo de toque de pelo menos 44px`).toBeGreaterThanOrEqual(44);
    }
    await lista.getByRole("link", { name: /^Estoque/ }).click();
    await expect(page.getByRole("heading", { name: "Estoque", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: "Configurações" }).first().click(); // botão voltar
    await expect(page).toHaveURL(/\/configuracoes$/);
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  await test.step("sem receita: o Início e Pacientes avisam e oferecem anexar", async () => {
    await open(page, "/pacientes");
    await expect(page.getByText("Sem receita anexada").first()).toBeVisible();
    await open(page, "/");
    const region = page.getByRole("region", { name: "Receitas que pedem atenção" });
    await expect(region.getByText("Sem receita anexada")).toBeVisible();
    await expect(region.getByRole("button", { name: "Anexar receita" })).toBeVisible();
  });

  await test.step("anexar uma receita com duas páginas (foto e PDF)", async () => {
    await open(page, "/receitas");
    await expect(page.getByText("Nenhuma receita ainda")).toBeVisible();
    await page.getByRole("button", { name: "Anexar a primeira receita" }).click();
    await attach(page, [jpg("pagina-1.jpg"), { name: "pagina-2.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await page.getByRole("link", { name: "Ver receita" }).click();
    await expect(page).toHaveURL(/\/receitas\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Receita de Losartana 50 mg" })).toBeVisible();
    await expect(page.getByText("Vigente").first()).toBeVisible();
    await expect(page.getByText(/Válida até/).first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Páginas da receita" })).toBeVisible();
    await expect(page.getByText("Ana Souza · ").first()).toBeVisible(); // quem anexou e quando
  });

  let signedUrl = "";
  await test.step("ver: a miniatura e o visualizador carregam pela rota do portal, página a página (PDF incluso), e registram quem viu", async () => {
    const thumb = page.locator('img[src^="/api/rx-file/"]').first();
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    signedUrl = (await thumb.getAttribute("src"))!;
    expect(signedUrl).toMatch(/\?v=thumb&exp=\d+&m=[0-9a-f-]{36}&sig=[0-9a-f]{64}$/);

    await page.getByRole("button", { name: /^Abrir Receita de Losartana 50 mg, página 1 de 2 em tela cheia/ }).click();
    const viewer = page.getByRole("dialog", { name: /Receita de Losartana 50 mg · página [12] de 2/ });
    await expect(viewer).toBeVisible();
    const big = viewer.locator("img").first();
    await expect.poll(() => big.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    expect(await big.getAttribute("src")).toContain("v=full");
    await viewer.getByRole("button", { name: "Próxima página" }).click();
    await expect(viewer.locator('iframe[src^="/api/rx-file/"]')).toBeAttached(); // a página 2 é PDF
    await viewer.getByRole("button", { name: "Aumentar zoom" }).click();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    await page.reload();
    await expect(page.getByText("Viu em").first()).toBeVisible();
  });

  await test.step("a rota de arquivo só serve quem tem sessão, permissão e a assinatura da própria pessoa", async () => {
    const anon = await browser.newContext({ baseURL: baseURL() });
    expect((await anon.request.get(signedUrl)).status()).toBe(401); // sem sessão
    await anon.close();
    expect((await neto.page.request.get(signedUrl)).status()).toBe(403); // Confirmador: sem permissão de ver receitas
    expect((await filha.page.request.get(signedUrl)).status()).toBe(403); // assinatura é da Ana, não da filha
    expect((await page.request.get(signedUrl.replace(/sig=[0-9a-f]{4}/, "sig=0000"))).status()).toBe(403); // assinatura adulterada
    expect((await page.request.get(signedUrl.replace(/exp=\d+/, "exp=1"))).status()).toBe(403); // vencida
    const ok = await page.request.get(signedUrl);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("image/jpeg");
  });

  await test.step("o perfil sem permissão não vê Receitas no menu nem a tela", async () => {
    await neto.page.reload();
    await expect(neto.page.getByRole("link", { name: "Receitas" })).toHaveCount(0);
    await open(neto.page, "/receitas");
    await expect(neto.page.getByText("Esta área não está liberada para o seu perfil")).toBeVisible();
    await open(neto.page, "/pacientes");
    await expect(neto.page.getByText("Receita vigente").first()).toBeVisible(); // o estado, sem o botão para abrir a receita
    await expect(neto.page.getByRole("button", { name: /Receita vigente/ })).toHaveCount(0);
  });

  await test.step("compartilhar dentro do portal: só quem pode ver; a filha recebe e o 'quem viu' registra a abertura", async () => {
    await page.getByRole("button", { name: "Compartilhar" }).click();
    const dlg = page.getByRole("dialog", { name: "Compartilhar receita" });
    await expect(dlg.getByText("Pelo WhatsApp")).toHaveCount(0); // o envio pelo WhatsApp é do Lote 4
    await expect(dlg.getByText("Sem permissão para ver receitas")).toBeVisible(); // o neto aparece bloqueado
    await expect(dlg.getByRole("checkbox", { name: /Neto Teste/ })).toBeDisabled();
    await dlg.getByRole("checkbox", { name: /Filha Teste/ }).check({ force: true }); // a caixa é desenhada por um <span> sobre o input
    await dlg.getByRole("button", { name: "Compartilhar com 1" }).click();
    await toast(page, "Receita compartilhada com Filha Teste");
    await expect(page.getByText(/Compartilhada com Filha Teste/)).toBeVisible();

    await open(filha.page, "/receitas");
    await expect(filha.page.getByText("Compartilhada por Ana")).toBeVisible();
    await filha.page.getByRole("link", { name: /Losartana 50 mg/ }).first().click();
    await filha.page.getByRole("button", { name: /^Abrir Receita de Losartana 50 mg, página 1 de 2/ }).click();
    await expect(filha.page.getByRole("dialog", { name: /página 1 de 2/ })).toBeVisible();
    await filha.page.keyboard.press("Escape");
    await open(page, page.url().replace(baseURL(), ""));
    await expect(page.getByText("Filha Teste").first()).toBeVisible();
    await expect(page.getByText(/Viu em/).first()).toBeVisible();
    await open(filha.page, "/receitas");
    await expect(filha.page.getByText("Compartilhada por Ana")).toHaveCount(0); // ela já abriu
  });

  await test.step("estoque cruza o limite: a reposição abre sozinha e o Início mostra a receita e os botões", async () => {
    await open(page, "/configuracoes/estoque");
    const aj = page.getByRole("form", { name: "Ajuste manual" });
    await aj.getByLabel(/Quanto tem agora/).fill("6");
    await aj.getByLabel(/Motivo/).fill("conferi a caixa");
    await aj.getByRole("button", { name: "Registrar ajuste" }).click();
    await toast(page, "Ajuste registrado");
    await open(page, "/");
    const card = page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ });
    await expect(card.getByText("Receita vigente")).toBeVisible();
    await expect(card.getByText("Reposição · etapa 1 de 4 · pedir receita ao médico")).toBeVisible();
    await expect(card.getByText("Ninguém assumiu ainda")).toBeVisible();
    await expect(card.getByRole("button", { name: "Ver receita" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Registrar compra" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Eu cuido disso" })).toBeVisible();
  });

  await test.step("a filha assume ('Eu cuido disso'); a Ana vê quem assumiu e só pode 'Assumir no lugar'", async () => {
    await open(filha.page, "/");
    const fcard = filha.page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ });
    await fcard.getByRole("button", { name: "Eu cuido disso" }).click();
    await toast(filha.page, "Combinado: Losartana 50 mg. A família foi avisada.");

    await open(page, "/");
    const card = page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ });
    await expect(card.getByText("Filha Teste vai pedir a receita")).toBeVisible();
    await card.getByRole("button", { name: "Ver reposição" }).click();
    const sheet = page.getByRole("dialog", { name: "Reposição de Losartana 50 mg" });
    await expect(sheet.getByRole("button", { name: "Assumir no lugar" })).toBeVisible();
    await sheet.getByRole("button", { name: "Assumir no lugar" }).click();
    await toast(page, "Combinado: Losartana 50 mg. A família foi avisada.");
    await expect(sheet.getByText("Você vai pedir a receita")).toBeVisible();
    await expect(sheet.getByText("Assumiu: vai pedir a receita").first()).toBeVisible(); // registro de cada ação

    // o sino da filha avisa a troca (e o da Ana avisou da assunção da filha)
    await open(filha.page, "/avisos");
    await expect(filha.page.getByText("Ana vai pedir a receita: Losartana 50 mg (Adelino)")).toBeVisible();
    await open(page, "/avisos");
    await expect(page.getByText("Filha vai pedir a receita: Losartana 50 mg (Adelino)")).toBeVisible();
    await expect(page.getByText("Estoque baixo: Losartana 50 mg (Adelino)")).toBeVisible();
  });

  await test.step("a filha não conclui a etapa que a Ana assumiu", async () => {
    await open(filha.page, "/");
    const fcard = filha.page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ });
    await fcard.getByRole("button", { name: "Ver reposição" }).click();
    await expect(filha.page.getByRole("dialog", { name: "Reposição de Losartana 50 mg" }).getByText(/Ana Souza vai pedir a receita/).first()).toBeVisible();
    await filha.page.keyboard.press("Escape");
  });

  await test.step("etapa 1 feita; etapa 2: anexar a receita recebida avança sozinha para 'Comprado'", async () => {
    await open(page, "/");
    const card = page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ });
    await card.getByRole("button", { name: "Marcar etapa feita" }).click();
    await toast(page, "Etapa concluída");
    await expect(card.getByText("Reposição · etapa 2 de 4 · receita recebida")).toBeVisible();
    await expect(card.getByText("Aguardando nova receita")).toBeVisible(); // o pedido ao médico deixa a receita atual 'aguardando nova'

    await card.getByRole("button", { name: "Eu cuido disso" }).click();
    await card.getByRole("button", { name: "Marcar etapa feita" }).click(); // sem receita nova: abre o anexar
    await attach(page, [jpg("nova.jpg")]);
    await page.getByRole("button", { name: "Concluir" }).click();
    await expect(card.getByText("Reposição · etapa 3 de 4 · comprado")).toBeVisible();
    await expect(card.getByText("Receita vigente")).toBeVisible();
  });

  await test.step("a receita antiga foi substituída pela nova", async () => {
    await open(page, "/receitas");
    await page.getByRole("button", { name: "Substituídas" }).click();
    await expect(page.getByText(/Substituída pela receita de/).first()).toBeVisible();
  });

  await test.step("registrar a compra: o estoque sobe, a previsão atualiza e a reposição se encerra", async () => {
    await open(page, "/");
    const card = page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ });
    await card.getByRole("button", { name: "Eu cuido disso" }).click();
    await card.getByRole("button", { name: "Marcar etapa feita" }).click();
    const dlg = page.getByRole("dialog", { name: "Quanto foi comprado?" });
    await dlg.getByLabel(/Quantidade comprada/).fill("60");
    await dlg.getByRole("button", { name: "Confirmar compra" }).click();
    await toast(page, "Compra registrada: 60 unidade");
    await expect(page.getByRole("article", { name: /^Losartana 50 mg, Adelino:/ })).toHaveCount(0); // saiu de "estoque perto de acabar"

    await open(page, "/configuracoes/estoque");
    await expect(page.getByRole("region", { name: "Estoque por urgência" }).getByText("66 comprimidos")).toBeVisible();
    await expect(page.getByText(/Compra · Losartana 50 mg \+60/).first()).toBeVisible();
  });

  await test.step("o histórico ganha os eventos de receita e reposição", async () => {
    await open(page, "/historico");
    for (const t of ["Receita anexada", "Receita compartilhada", "Assumiu a reposição", "Etapa de reposição concluída", "Reposição concluída"]) {
      await expect(page.getByText(t).first()).toBeVisible();
    }
    // a filha (Familiar, vê receitas) também vê; o neto (Confirmador) não tem o histórico
    await open(filha.page, "/historico");
    await expect(filha.page.getByText("Receita anexada").first()).toBeVisible();
    await open(neto.page, "/historico");
    await expect(neto.page.getByText("Esta área não está liberada para o seu perfil")).toBeVisible();
  });

  await test.step("excluir a receita (com desfazer): some do portal e a página deixa de ser entregue", async () => {
    await open(page, "/receitas");
    await page.getByRole("link", { name: /Losartana 50 mg/ }).first().click();
    const pageUrl = await page.locator('img[src^="/api/rx-file/"]').first().getAttribute("src");
    await page.getByRole("button", { name: "Excluir" }).click();
    await page.getByRole("button", { name: "Excluir receita" }).click();
    await toast(page, "Receita excluída");
    expect((await page.request.get(pageUrl!)).status()).toBe(404);
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect.poll(async () => (await page.request.get(pageUrl!)).status()).toBe(200);
    await open(page, "/receitas");
    await expect(page.getByRole("link", { name: /Losartana 50 mg/ }).first()).toBeVisible();
  });

  await filha!.ctx.close();
  await neto!.ctx.close();
});
