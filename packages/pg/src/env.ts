import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carrega o .env da raiz do monorepo, sem sobrescrever variáveis já definidas (Node 20.12+).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const file = path.join(root, ".env");
if (existsSync(file)) {
  try {
    process.loadEnvFile(file);
  } catch {
    /* arquivo ilegível: segue só com o ambiente */
  }
}

// Padrões do Postgres de desenvolvimento (docker-compose.dev.yml). Valem só fora de produção.
const DEV_APP = "postgres://medcuidar_app:medcuidar_app_dev@localhost:5440/medcuidar";
const DEV_ADMIN = "postgres://medcuidar_owner:medcuidar_owner_dev@localhost:5440/medcuidar";

function valid(name: string, raw: string | undefined, devDefault: string): string {
  const url = raw || (process.env.NODE_ENV === "production" ? undefined : devDefault);
  if (!url) throw new Error(`${name} não definida (veja .env.example)`);
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error(`${name} inválida: precisa começar com postgres://`);
  return url;
}

/** URL do papel de APLICAÇÃO (sem BYPASSRLS). */
export function appUrl(): string {
  return valid("DATABASE_URL", process.env.DATABASE_URL, DEV_APP);
}

/** URL do papel de MIGRAÇÃO/dono. Só para migrate, seed e testes — nunca para a aplicação. */
export function adminUrl(): string {
  return valid("DATABASE_URL_ADMIN", process.env.DATABASE_URL_ADMIN, DEV_ADMIN);
}
