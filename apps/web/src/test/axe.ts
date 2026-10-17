import { configureAxe } from "vitest-axe";

/**
 * axe em jsdom, sem CSS: color-contrast não é calculável (contraste é medido em tokens.test.ts),
 * "region" vale para páginas inteiras e "landmark-unique" dispara porque o jsdom mostra o menu
 * mobile e o desktop ao mesmo tempo (no navegador um deles fica display:none).
 */
export const axe = configureAxe({
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
    "landmark-unique": { enabled: false },
    "landmark-no-duplicate-banner": { enabled: false },
  },
});
