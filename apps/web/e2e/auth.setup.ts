import { test as setup } from "@playwright/test";
import { AUTH, PHONE, login } from "./helpers";

// Entra uma vez por pessoa e guarda a sessão (cookie httpOnly) para os outros testes.
setup("sessão da Ana (administradora)", async ({ page }) => {
  await login(page, PHONE.ana);
  await page.context().storageState({ path: AUTH.ana });
});

setup("sessão do Seu João (confirmador)", async ({ page }) => {
  await login(page, PHONE.joao);
  await page.context().storageState({ path: AUTH.joao });
});
