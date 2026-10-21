import "server-only";

/**
 * Variáveis do SERVIDOR. Nada daqui vai para o cliente (nenhuma começa com NEXT_PUBLIC_).
 * DATA_SOURCE=appwrite|mock escolhe a origem dos dados das telas (padrão: mock).
 */
export type DataSourceKind = "postgres" | "mock";

/** postgres = Lote 1+ (Postgres + Appwrite Auth). mock = dados fictícios em memória (sem login), só para desenvolvimento/testes. */
export const dataSourceKind = (): DataSourceKind => (process.env["DATA_SOURCE"] === "postgres" ? "postgres" : "mock");

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

/** Appwrite só para Auth (e-mail/senha) e, nos próximos lotes, o bucket de receitas. A chave fica só no servidor. */
export const appwriteAuthEnv = () => ({
  endpoint: need("APPWRITE_ENDPOINT"),
  projectId: need("APPWRITE_PROJECT_ID"),
  apiKey: need("APPWRITE_API_KEY"),
});

/** URL pública do portal (sem barra no fim), usada nos links dos e-mails. Ex.: https://staging.exemplo.com.br */
export const appUrl = (): string => need("APP_URL").replace(/\/+$/, "");

/** Segredo para assinar as URLs curtas dos arquivos de receita: `FILE_URL_SECRET` (preferida) ou, no legado, `LOGIN_CODE_SECRET`. */
export const fileUrlSecret = (): string => {
  const s = process.env["FILE_URL_SECRET"] || process.env["LOGIN_CODE_SECRET"];
  if (!s || s.length < 16) throw new Error("Defina FILE_URL_SECRET com pelo menos 16 caracteres");
  return `file-url:${s}`;
};

/** Id do bucket PRIVADO das receitas no Appwrite (docs/09, seção "Lote 3"). Vazio = armazenamento ainda não configurado. */
export const prescriptionsBucketId = (): string | undefined => process.env["APPWRITE_PRESCRIPTIONS_BUCKET_ID"] || undefined;

/** Só no e2e: guarda as páginas das receitas na memória do servidor em vez do Appwrite (recusado com APP_ENV=production). */
export const memoryStorageForTests = (): boolean => e2eTestMode() && process.env["RX_STORAGE"] === "memory";

/** Modo de teste (e2e): canal falso em memória e rota que devolve o último código de login. Recusado se APP_ENV=production. */
export const e2eTestMode = (): boolean => process.env["E2E_TEST_MODE"] === "1" && process.env["APP_ENV"] !== "production";

export const PRESCRIPTION_BUCKET = "prescriptions";
