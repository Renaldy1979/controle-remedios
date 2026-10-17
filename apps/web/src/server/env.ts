import "server-only";

/**
 * Variáveis do SERVIDOR. Nada daqui vai para o cliente (nenhuma começa com NEXT_PUBLIC_).
 * DATA_SOURCE=appwrite|mock escolhe a origem dos dados das telas (padrão: mock).
 */
export type DataSourceKind = "appwrite" | "mock";

export const dataSourceKind = (): DataSourceKind => (process.env["DATA_SOURCE"] === "appwrite" ? "appwrite" : "mock");

export function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Variável de ambiente ausente: ${key}`);
  return v;
}

export const appwriteEnv = () => ({
  endpoint: need("APPWRITE_ENDPOINT"),
  projectId: need("APPWRITE_PROJECT_ID"),
  databaseId: need("APPWRITE_DATABASE_ID"),
  apiKey: need("APPWRITE_API_KEY"),
});

/** Segredo para assinar as URLs curtas dos arquivos de receita (derivado do segredo do servidor; a sessão é do Appwrite). */
export const fileUrlSecret = (): string => {
  const s = process.env["LOGIN_CODE_SECRET"];
  if (!s || s.length < 16) throw new Error("Defina LOGIN_CODE_SECRET com pelo menos 16 caracteres");
  return `file-url:${s}`;
};

/** Modo de teste (e2e): canal falso em memória e rota que devolve o último código de login. Recusado se APP_ENV=production. */
export const e2eTestMode = (): boolean => process.env["E2E_TEST_MODE"] === "1" && process.env["APP_ENV"] !== "production";

export const PRESCRIPTION_BUCKET = "prescriptions";
