import { defineConfig, devices } from "@playwright/test";

/**
 * e2e contra a FAMÍLIA DEMO (demo-familia-souza, telefones fictícios), com canal de WhatsApp falso:
 * o código de login é lido de /api/test/last-login-code (só existe com E2E_TEST_MODE=1).
 * Nunca roda com dados reais nem manda mensagem de verdade.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env["E2E_BROWSER_CHANNEL"] ?? "msedge",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"], channel: process.env["E2E_BROWSER_CHANNEL"] ?? "msedge" } },
    { name: "desktop", dependencies: ["setup"], testIgnore: /auth\.setup\.ts/, use: { ...devices["Desktop Chrome"], channel: process.env["E2E_BROWSER_CHANNEL"] ?? "msedge", viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    // build de produção: sem recompilação a quente (que reinicia a página no meio do teste)
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !!process.env["E2E_REUSE_SERVER"],
    timeout: 480_000,
    env: { DATA_SOURCE: "appwrite", E2E_TEST_MODE: "1" },
  },
});
