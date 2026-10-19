import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { adminUrl } from "./env";

/** Aplica as migrações com o papel dono (DATABASE_URL_ADMIN), nunca com o papel da aplicação. */
export async function runMigrations(url = adminUrl()): Promise<void> {
  const folder = process.env.MIGRATIONS_FOLDER ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: folder });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMigrations();
  console.warn("Migrações aplicadas.");
}
