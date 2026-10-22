import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { PREFIX, cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Lote 4B, Parte A do roteiro (sem número real): Configurações › WhatsApp › ligação com o N8N.
 * Um servidor falso faz o papel do fluxo 05: confere o segredo do cabeçalho e responde { ok, versao }.
 * Também confere a criação da chave `cpl_` pelo portal (mostrada uma vez, com a instrução do N8N).
 * Apaga tudo o que criou (usuários `zz-test-*` do Appwrite, famílias e chaves do Postgres).
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const emailA = testEmail("l4b-admin");
let n8nFalso: Server;
let urlFalsa = "";
let segredoEsperado = "";
let chamadas = 0;

test.beforeAll(async () => {
  await cleanup();
  n8nFalso = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      chamadas++;
      const ok = !!segredoEsperado && req.headers["x-medcuidar-token"] === segredoEsperado && !!req.headers["x-medcuidar-assinatura"];
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(ok ? { ok: true, versao: "1.0.0" } : { ok: false }));
    });
  });
  await new Promise<void>((r) => n8nFalso.listen(0, "127.0.0.1", r));
  urlFalsa = `http://127.0.0.1:${(n8nFalso.address() as AddressInfo).port}/webhook/medcuidar-teste-conexao`;
});
test.afterAll(async () => {
  n8nFalso.closeAllConnections();
  await new Promise<void>((r) => n8nFalso.close(() => r()));
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

test("Lote 4B: aguardando conexão → URL → segredo → Testar conexão → conectado; chave cpl_ pelo portal", async ({ page }) => {
  await test.step("conta e família", async () => {
    await signUp(page, "Ana Souza", emailA);
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await page.getByLabel("Nome da família").fill("Família L4B ZZ");
    await page.getByRole("button", { name: "Criar a família" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  const card = () => page.getByRole("region", { name: "Ligação com o N8N" });

  await test.step("começa 'aguardando conexão' e o teste está desligado", async () => {
    await open(page, "/configuracoes/whatsapp");
    await expect(card().getByText(/Aguardando conexão$/)).toBeVisible();
    await expect(card().getByRole("button", { name: "Testar conexão" })).toBeDisabled();
  });

  await test.step("texto que não é URL é recusado", async () => {
    await card().getByLabel(/Endereço do webhook/).fill("isso não é uma url");
    await card().getByRole("button", { name: "Salvar endereço" }).click();
    await expect(card().getByText(/URL válida/)).toBeVisible();
  });

  await test.step("salva o endereço, gera o segredo (uma vez) e libera o teste", async () => {
    await card().getByLabel(/Endereço do webhook/).fill(urlFalsa);
    await card().getByRole("button", { name: "Salvar endereço" }).click();
    await expect(page.getByText("Endereço salvo").first()).toBeVisible();
    await card().getByRole("button", { name: "Gerar segredo" }).click();
    const alerta = card().getByRole("alert");
    await expect(alerta).toContainText("não será mostrado de novo");
    await expect(alerta).toContainText("MedCuidar Teste de conexão");
    segredoEsperado = (await alerta.locator("code").first().innerText()).trim();
    expect(segredoEsperado).toMatch(/^whsec_[0-9a-f]{48}$/);
    await card().getByRole("button", { name: "Já copiei" }).click();
    await expect(card().getByRole("button", { name: "Testar conexão" })).toBeEnabled();
    await open(page, "/configuracoes/whatsapp");
    expect(await page.content()).not.toContain(segredoEsperado);
  });

  await test.step("segredo errado no N8N → mensagem amigável e continua aguardando", async () => {
    const certo = segredoEsperado;
    segredoEsperado = "whsec_outro";
    await card().getByRole("button", { name: "Testar conexão" }).click();
    await expect(card().getByRole("status")).toContainText("recusou o segredo");
    await expect(card().getByText(/Aguardando conexão$/)).toBeVisible();
    segredoEsperado = certo;
  });

  await test.step("segredo certo → N8N conectado, com a versão dos fluxos", async () => {
    await card().getByRole("button", { name: "Testar conexão" }).click();
    await expect(card().getByRole("status")).toContainText("Conectado ao N8N (fluxos versão 1.0.0)");
    await expect(card().getByText("N8N conectado")).toBeVisible();
    expect(chamadas).toBeGreaterThanOrEqual(2);
    await open(page, "/configuracoes/whatsapp");
    await expect(card().getByText("N8N conectado")).toBeVisible();
    await page.screenshot({ path: "test-results/l4b-n8n-desktop.png", fullPage: true });
  });

  await test.step("chave cpl_ pelo portal: aparece uma vez, com a instrução, vale na API e revoga", async () => {
    const chaves = page.getByRole("region", { name: "Chave da plataforma (N8N)" });
    await chaves.getByLabel("Nome da nova chave").fill(`${PREFIX}n8n`);
    await chaves.getByRole("button", { name: "Criar chave" }).click();
    const alerta = chaves.getByRole("alert");
    await expect(alerta).toContainText("MedCuidar API");
    await expect(alerta).toContainText("Header Auth");
    const chave = (await alerta.locator("code").first().innerText()).trim();
    expect(chave).toMatch(/^cpl_/);
    const ok = await page.request.get("/api/v1/sistema/saude", { headers: { authorization: `Bearer ${chave}` } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).dados.ok).toBe(true);
    await chaves.getByRole("button", { name: "Já copiei" }).click();
    await open(page, "/configuracoes/whatsapp");
    expect(await page.content()).not.toContain(chave);
    await page.getByRole("region", { name: "Chave da plataforma (N8N)" }).getByRole("button", { name: "Revogar" }).click();
    await expect(page.getByText("Chave revogada").first()).toBeVisible();
    const negada = await page.request.get("/api/v1/sistema/saude", { headers: { authorization: `Bearer ${chave}` } });
    expect(negada.status()).toBe(401);
  });

  await test.step("capturas: 390 e 1280 px, claro e escuro, sem rolagem horizontal", async () => {
    for (const [w, h, cor] of [[1280, 900, "light"], [1280, 900, "dark"], [390, 844, "light"], [390, 844, "dark"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: cor });
      await open(page, "/configuracoes/whatsapp");
      await page.waitForTimeout(600);
      await page.screenshot({ path: `test-results/visual-n8n-${w}-${cor}.png`, fullPage: true });
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura, `sem rolagem horizontal em ${w}px`).toBeLessThanOrEqual(w + 1);
    }
  });
});
