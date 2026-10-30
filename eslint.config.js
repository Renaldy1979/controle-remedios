import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/next-env.d.ts", "design/**", "docs/**", "prompts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // serviço de backup: JavaScript puro em Node, com saída no console (é um programa de linha de comando)
    files: ["apps/backup/**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", process: "readonly", console: "readonly", fetch: "readonly", URL: "readonly", AbortSignal: "readonly", setTimeout: "readonly" },
    },
    rules: { "no-console": "off" },
  },
);
