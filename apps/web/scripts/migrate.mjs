// Aplica as migrações do banco (packages/pg/drizzle) com o papel DONO. Roda DENTRO da imagem do portal:
//   DATABASE_URL_ADMIN='postgres://medcuidar_owner:SENHA@HOST:5432/medcuidar' node /app/migrate/migrate.mjs
// A URL do dono é digitada só neste comando; ela NÃO fica nas variáveis do serviço (a aplicação usa o papel "app").
/* global process, console */
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL_ADMIN;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error("Defina DATABASE_URL_ADMIN com o endereço do banco no papel DONO (começa com postgres://). Veja docs/09-deploy-staging.md.");
  process.exit(1);
}

const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "drizzle");
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: folder });
  console.warn("Migrações aplicadas.");
} catch (e) {
  console.error("Falha ao aplicar as migrações:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
