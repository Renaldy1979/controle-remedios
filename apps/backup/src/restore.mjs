// Restauração e verificação. `restoreDb` nunca mexe no banco de produção sem a trava explícita.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { decryptTo } from "./crypto.mjs";
import { compareCounts, prepareRoles, restoreDump, tableCounts, withScratchDatabase } from "./db.mjs";
import { stampDate } from "./run.mjs";

/** Backups do banco, do mais novo para o mais velho, com o resumo guardado ao lado. */
export async function listBackups(storage) {
  const keys = (await storage.list("db/")).map((i) => i.key).filter((k) => stampDate(k)).sort((a, b) => stampDate(b) - stampDate(a));
  const out = [];
  for (const key of keys) {
    const metaKey = key.replace(/\.dump\.enc$/, ".meta.json");
    const meta = (await storage.exists(metaKey)) ? JSON.parse((await storage.getBuffer(metaKey)).toString("utf8")) : null;
    out.push({ key, date: stampDate(key), meta });
  }
  return out;
}

/** Baixa, abre e confere um backup; restaura em `targetUrl`; compara as contagens. */
export async function restoreDb({ cfg, storage, key, targetUrl, clean = false, prepare = false, allowProduction = false, log = console.log }) {
  if (targetUrl === cfg.databaseUrl && !allowProduction) {
    throw new Error("O destino é o próprio banco de produção. Restaure num banco novo, ou use --producao para confirmar de propósito.");
  }
  const all = await listBackups(storage);
  const chosen = key ? all.find((b) => b.key === key) : all[0];
  if (!chosen) throw new Error(key ? `Backup não encontrado: ${key}` : "Nenhum backup encontrado.");
  if (!chosen.meta) throw new Error("Este backup não tem o arquivo de resumo (.meta.json); não dá para conferir.");

  const tmp = await mkdtemp(join(tmpdir(), "mcbk-restore-"));
  try {
    const enc = join(tmp, "db.dump.enc");
    const plain = join(tmp, "db.dump");
    await storage.get(chosen.key, enc);
    await decryptTo(enc, plain, cfg.passphrase);
    const hash = createHash("sha256");
    await pipeline(createReadStream(plain), hash);
    if (hash.digest("hex") !== chosen.meta.sha256) throw new Error("A conferência (sha256) do dump falhou: o backup está corrompido.");
    log(`backup ${chosen.key} aberto e conferido`);

    if (prepare) await prepareRoles(targetUrl);
    await restoreDump(targetUrl, plain, { bin: cfg.pgRestoreBin, clean });
    const after = await tableCounts(targetUrl);
    const cmp = compareCounts(chosen.meta.tables, after.counts);
    log(`restauração concluída: ${cmp.rows.length} tabelas conferidas, ${cmp.identical ? "todas iguais" : "algumas com contagem diferente"}`);
    return { key: chosen.key, ...cmp };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Prova de que o backup serve: restaura num banco descartável e apaga em seguida. */
export function verifyLatest({ cfg, storage, adminUrl, key, log = console.log }) {
  return withScratchDatabase(adminUrl, (scratchUrl) => restoreDb({ cfg, storage, key, targetUrl: scratchUrl, log }));
}
