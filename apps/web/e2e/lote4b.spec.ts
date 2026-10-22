import { expect, test, type Page } from "@playwright/test";
import { cleanup, open, signUp, testEmail, verifyEmail } from "./support";

/**
 * Lote 4B, Parte A do roteiro (docs/lotes/L4B-roteiro.md), SEM número real e sem chaves de IA: o simulador atravessa a MESMA fila do
 * Postgres e o MESMO worker do WhatsApp real. Confere: PARAR/REATIVAR, "digitando…", pergunta livre sem a chave do Claude, o painel do
 * administrador (instância, worker, filas, uso de IA e limite) e que nada do N8N sobrou. Apaga tudo o que criou.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const emailA = testEmail("l4b-admin");
const meuTel = `5599${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

test.beforeAll(async () => {
  await cleanup();
});
test.afterAll(async () => {
  const r = await cleanup();
  console.warn(`[e2e] limpeza: ${r.appwriteUsers} usuário(s) do Appwrite e ${r.families} família(s) do Postgres removidos`);
});

async function falar(page: Page, texto: string) {
  await page.getByLabel("Mensagem", { exact: true }).fill(texto);
  await page.getByRole("button", { name: "Enviar" }).click();
}
const conversa = (page: Page) => page.getByRole("log", { name: "Mensagens" });

test("Lote 4B: simulador pela fila e pelo worker, PARAR/REATIVAR, painel do WhatsApp e limite de IA", async ({ page }) => {
  await test.step("conta, família e número verificado pelo simulador", async () => {
    await signUp(page, "Ana Souza", emailA);
    await verifyEmail(emailA);
    await page.getByRole("button", { name: "Já confirmei" }).click();
    await page.getByLabel("Nome da família").fill("Família L4B ZZ");
    await page.getByRole("button", { name: "Criar a família" }).click();
    await expect(page).toHaveURL(/\/$/);
    await open(page, "/configuracoes/whatsapp");
    await page.getByLabel("Celular com DDD").fill(meuTel);
    await page.getByRole("button", { name: "Gerar código" }).click();
    const codigo = await page.getByRole("status").filter({ hasText: "Envie este código" }).locator("p[aria-label^='Código']").innerText();
    await open(page, "/configuracoes/simulador");
    await falar(page, `CÓDIGO ${codigo}`);
    await expect(conversa(page).getByText("Número verificado")).toBeVisible();
    await expect(page.getByText("digitando… (simulado").first()).toBeVisible();
  });

  await test.step("PARAR: avisos pausados (sem modelo); o portal continua; REATIVAR volta", async () => {
    await falar(page, "PARAR");
    await expect(conversa(page).getByText("Avisos pausados")).toBeVisible();
    await falar(page, "reativar");
    await expect(conversa(page).getByText("Avisos de volta")).toBeVisible();
  });

  await test.step("pergunta livre sem a chave do Claude: o assistente está indisponível e o resto funciona", async () => {
    await falar(page, "qual a melhor dieta para diabetes?");
    await expect(conversa(page).getByText(/assistente de perguntas está indisponível/)).toBeVisible();
    await falar(page, "ajuda");
    await expect(conversa(page).getByText(/Responda|tomei/i).last()).toBeVisible();
  });

  await test.step("painel Configurações › WhatsApp: instância, worker, filas e uso de IA; nada do N8N", async () => {
    await open(page, "/configuracoes/whatsapp");
    const painel = page.getByRole("region", { name: "WhatsApp do sistema" });
    await expect(painel).toBeVisible();
    await expect(painel.getByText("Aguardando conexão")).toBeVisible();
    await expect(painel.getByText(/Worker desligado/)).toBeVisible();
    await expect(painel.getByText("Mensagens recebidas")).toBeVisible();
    await expect(painel.getByText(/Sem ANTHROPIC_API_KEY/)).toBeVisible();
    await expect(painel.getByRole("progressbar", { name: "Uso do limite mensal de IA" })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/N8N|Testar conexão|cpl_|HMAC/);
  });

  await test.step("limite mensal de IA: valor inválido é recusado e o válido fica salvo", async () => {
    const painel = page.getByRole("region", { name: "WhatsApp do sistema" });
    await painel.getByLabel("Limite mensal (US$)").fill("abc");
    await painel.getByRole("button", { name: "Salvar limite" }).click();
    await expect(painel.getByText(/valor em dólares/)).toBeVisible();
    await painel.getByLabel("Limite mensal (US$)").fill("7,50");
    await painel.getByRole("button", { name: "Salvar limite" }).click();
    await expect(painel.getByText("US$ 7,50").first()).toBeVisible();
    await open(page, "/configuracoes/whatsapp");
    await expect(page.getByRole("region", { name: "WhatsApp do sistema" }).getByText("US$ 7,50").first()).toBeVisible();
  });

  await test.step("capturas: painel e simulador em 390 e 1280 px, claro e escuro", async () => {
    for (const [w, h, cor] of [[1280, 900, "light"], [1280, 900, "dark"], [390, 844, "light"], [390, 844, "dark"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: cor });
      for (const [rota, nome] of [["/configuracoes/whatsapp", "l4b-whatsapp"], ["/configuracoes/simulador", "l4b-simulador"]] as const) {
        await open(page, rota);
        await page.waitForTimeout(600);
        await page.screenshot({ path: `test-results/visual-${nome}-${w}-${cor}.png`, fullPage: true });
        const largura = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        expect(largura, `${nome} ${w} ${cor} sem rolagem horizontal`).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: "light" });
  });
});
