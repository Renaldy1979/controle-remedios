import { defineConfig, devices } from "@playwright/test";

/**
 * e2e do Lote 1 contra o Postgres local (pnpm db:up) e o Appwrite configurado no .env (só Auth).
 * Cria usuários com o prefixo `zz-test-` e apaga tudo ao final (Appwrite e Postgres). O e-mail de convite NÃO é enviado:
 * no modo de teste o link é lido de /api/test/invite-link (só existe com E2E_TEST_MODE=1).
 */
const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const channel = process.env["E2E_BROWSER_CHANNEL"] ?? "msedge";

export default defineConfig({
  testDir: "./e2e",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1280, height: 900 } } }],
  webServer: {
    // build de produção: sem recompilação a quente (que reinicia a página no meio do teste)
    command: `${process.env["E2E_SKIP_BUILD"] ? "" : "pnpm exec next build && "}pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !!process.env["E2E_REUSE_SERVER"],
    timeout: 900_000,
    // RX_STORAGE=memory (só com E2E_TEST_MODE=1): as páginas das receitas ficam na memória do servidor de teste, não no bucket do Appwrite
    env: { DATA_SOURCE: "postgres", E2E_TEST_MODE: "1", SIMULATOR_ENABLED: "1", RX_STORAGE: "memory", FILE_URL_SECRET: "e2e-segredo-de-teste-com-mais-de-16-caracteres", APP_URL: `http://localhost:${PORT}`, NEXT_SKIP_TYPECHECK: "1",
      // `next start` roda em produção, onde o banco não tem URL padrão: usa o Postgres local do docker-compose.dev.yml
      DATABASE_URL: process.env["DATABASE_URL"] ?? "postgres://medcuidar_app:medcuidar_app_dev@localhost:5440/medcuidar",
    },
  },
});
