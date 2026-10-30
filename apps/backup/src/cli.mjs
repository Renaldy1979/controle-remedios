#!/usr/bin/env node
// Uso: node src/cli.mjs <serve | once | list | restore-db | restore-files | verify>   (guia completo: docs/12-backup.md)
import { loadConfig } from "./config.mjs";
import { appwriteSource, restoreFiles } from "./files.mjs";
import { LAST_RUN, backupOnce, isDue } from "./run.mjs";
import { listBackups, restoreDb, verifyLatest } from "./restore.mjs";
import { createStorage } from "./storage.mjs";

const log = (msg) => console.log(`[backup] ${new Date().toISOString()} ${msg}`);
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(`--${name}`);
const opt = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  const cfg = loadConfig();
  const storage = createStorage(cfg.storage);

  switch (cmd) {
    case "once":
      await backupOnce(cfg, storage, { log });
      log("backup concluído");
      return;

    case "serve": {
      log(`serviço no ar: backup diário às ${cfg.at} (${cfg.tz}), guarda ${cfg.retentionDays} dias`);
      const last = (await storage.exists(LAST_RUN)) ? JSON.parse((await storage.getBuffer(LAST_RUN)).toString("utf8")) : null;
      // não repete o backup de hoje se o serviço só foi reiniciado
      let lastDate = last?.ok ? isDue(new Date(last.at), cfg.tz, "00:00", null).date : null;
      // se o último backup é velho (serviço ficou fora do ar), roda já na subida
      if (!last?.ok || Date.now() - Date.parse(last.at) > 26 * 3_600_000) {
        log("último backup ausente ou antigo: rodando agora");
        await backupOnce(cfg, storage, { log }).catch((e) => log(`FALHA: ${e.message}`));
        lastDate = isDue(new Date(), cfg.tz, "00:00", null).date;
      }
      for (;;) {
        const { due, date } = isDue(new Date(), cfg.tz, cfg.at, lastDate);
        if (due) {
          lastDate = date;
          await backupOnce(cfg, storage, { log }).then(() => log("backup concluído"), (e) => log(`FALHA: ${e.message}`));
        }
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }

    case "list": {
      for (const b of await listBackups(storage)) {
        const n = b.meta ? Object.values(b.meta.tables).reduce((a, x) => a + x, 0) : "?";
        console.log(`${b.key}  ${b.date.toISOString()}  ${b.meta ? b.meta.encryptedBytes : "?"} bytes  ${n} linhas`);
      }
      return;
    }

    case "restore-db": {
      const to = opt("para");
      if (!to) throw new Error("Informe o banco de destino: --para postgres://usuario:senha@host:5432/banco_novo");
      const r = await restoreDb({ cfg, storage, key: opt("backup"), targetUrl: to, clean: flag("limpar"), prepare: flag("criar-papeis"), allowProduction: flag("producao"), log });
      for (const row of r.rows) console.log(`${row.status.padEnd(9)} ${row.table}: backup ${row.expected} / restaurado ${row.actual}`);
      if (r.fatal) process.exitCode = 2;
      return;
    }

    case "restore-files": {
      if (!cfg.appwrite) throw new Error("Appwrite não configurado (APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_PRESCRIPTIONS_BUCKET_ID).");
      await restoreFiles({ source: appwriteSource(cfg.appwrite), storage, passphrase: cfg.passphrase, dryRun: flag("simular"), log });
      return;
    }

    case "verify": {
      const admin = opt("admin") || process.env.DATABASE_URL_VERIFY_ADMIN;
      if (!admin) throw new Error("Informe um servidor Postgres onde criar o banco de teste: --admin postgres://... (usuário com permissão de criar bancos) ou DATABASE_URL_VERIFY_ADMIN.");
      const r = await verifyLatest({ cfg, storage, adminUrl: admin, key: opt("backup"), log });
      log(`verificação ${r.fatal ? "FALHOU" : r.identical ? "OK (contagens idênticas)" : "OK com diferenças pequenas de contagem"} — ${r.key}`);
      if (r.fatal) process.exitCode = 2;
      return;
    }

    default:
      console.log("Comandos: serve | once | list | restore-db --para <url> [--backup <chave>] [--criar-papeis] [--limpar] | restore-files [--simular] | verify --admin <url>");
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((e) => {
  log(`ERRO: ${e.message}`);
  process.exit(1);
});
