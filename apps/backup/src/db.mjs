// Postgres: dump (pg_dump), restauração (pg_restore) e contagem de linhas por tabela (para conferir o backup).
import { spawn } from "node:child_process";
import postgres from "postgres";

/** Variáveis PG* a partir de uma URL: a senha vai por ambiente, nunca na linha de comando. */
export function pgEnv(url) {
  const u = new URL(url);
  const env = {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
  const ssl = u.searchParams.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  return env;
}

function run(bin, args, env, { tolerate } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => reject(new Error(`Não foi possível executar ${bin}: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve(err);
      // `tolerate`: erros conhecidos e inofensivos (ex.: parâmetro novo do Postgres 17 num servidor 16) não derrubam a rodada
      const lines = err.split("\n").filter((l) => /^pg_restore: error:|^pg_dump: error:/.test(l));
      if (tolerate && lines.length > 0 && lines.every((l) => tolerate.test(l))) return resolve(err);
      reject(new Error(`${bin} terminou com erro (código ${code}). ${err.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
}

// Diferença de versão entre o pg_dump e o servidor de destino: SETs que o servidor mais antigo não conhece.
const HARMLESS_RESTORE_ERROR = /unrecognized configuration parameter "(transaction_timeout|idle_session_timeout)"/;

/** Gera o dump comprimido (formato custom do pg_dump) em `outPath`. */
export async function dumpDatabase(url, outPath, bin = "pg_dump") {
  await run(bin, ["--format=custom", "--compress=6", "--no-owner", "--file", outPath], pgEnv(url));
}

/** Restaura um dump em `url`. Com `clean`, apaga antes o que existir (uso em emergência). */
export async function restoreDump(url, dumpPath, { bin = "pg_restore", clean = false } = {}) {
  const args = ["--no-owner", ...(clean ? ["--clean", "--if-exists"] : []), "--dbname", pgEnv(url).PGDATABASE, dumpPath];
  // sem --exit-on-error: o SET desconhecido não interrompe; qualquer outro erro continua derrubando a restauração
  await run(bin, args, pgEnv(url), { tolerate: HARMLESS_RESTORE_ERROR });
}

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

/** Linhas de cada tabela do schema public e a versão do servidor. Só números e nomes de tabela. */
export async function tableCounts(url) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
    const counts = {};
    for (const t of tables) {
      const [row] = await sql.unsafe(`select count(*)::int as n from public.${quote(t.table_name)}`);
      counts[t.table_name] = row.n;
    }
    const [{ v }] = await sql`select current_setting('server_version') as v`;
    return { counts, serverVersion: v };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Cria os papéis do sistema (sem login) num banco de teste, para a restauração dos privilégios não falhar. */
export async function prepareRoles(url) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const role of ["medcuidar_owner", "medcuidar_app", "medcuidar_backup"]) {
      await sql.unsafe(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Cria e apaga bancos de teste (para o `verify`). `adminUrl` precisa poder criar bancos. */
export async function withScratchDatabase(adminUrl, fn) {
  const name = `medcuidar_verify_${Date.now()}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${quote(name)}`);
    const u = new URL(adminUrl);
    u.pathname = `/${name}`;
    try {
      await prepareRoles(u.toString());
      return await fn(u.toString());
    } finally {
      await admin.unsafe(`drop database if exists ${quote(name)} with (force)`);
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** Compara as contagens do backup com as do banco restaurado. */
export function compareCounts(expected, actual) {
  const rows = Object.keys(expected).map((t) => {
    const was = expected[t];
    const now = actual[t];
    const status = now === undefined ? "faltando" : now === was ? "ok" : "diferente";
    return { table: t, expected: was, actual: now ?? null, status };
  });
  // "diferente" pode ser só movimento do sistema entre a contagem e o dump; "faltando" ou vazio de verdade é grave
  const fatal = rows.some((r) => r.status === "faltando" || (r.actual === 0 && r.expected > 0));
  return { rows, fatal, identical: rows.every((r) => r.status === "ok") };
}
