// Uma rodada de backup: banco (dump criptografado + conferência) -> retenção -> fotos -> registro da última rodada -> aviso de saúde.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { encryptTo } from "./crypto.mjs";
import { dumpDatabase, tableCounts } from "./db.mjs";
import { appwriteSource, syncFiles } from "./files.mjs";

export const LAST_RUN = "state/last-run.json";

export const stampOf = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-"); // 20261030-060000
export const dumpKey = (d) => `db/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/medcuidar-${stampOf(d)}.dump.enc`;

/** Data (UTC) escrita no nome do arquivo, ou null. */
export function stampDate(key) {
  const m = /medcuidar-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.dump\.enc$/.exec(key);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

/** Dumps vencidos: mais velhos que `days`, sempre preservando os `keepMin` mais recentes. */
export function selectExpired(keys, now, days, keepMin = 3) {
  const dumps = keys.filter((k) => stampDate(k)).sort((a, b) => stampDate(b) - stampDate(a));
  return dumps.slice(keepMin).filter((k) => now.getTime() - stampDate(k).getTime() > days * 86_400_000);
}

const sha256 = async (path) => {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
};

async function ping(url, suffix = "") {
  if (!url) return;
  try {
    await fetch(url.replace(/\/$/, "") + suffix, { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch {
    // aviso é só um extra: nunca derruba o backup
  }
}

/**
 * `deps` existe para os testes trocarem o pg_dump, as contagens e o Appwrite.
 * Devolve o resumo; em caso de erro registra a falha, avisa o monitor e relança.
 */
export async function backupOnce(cfg, storage, { now = new Date(), log = console.log, deps = {} } = {}) {
  const dump = deps.dumpDatabase ?? ((url, out) => dumpDatabase(url, out, cfg.pgDumpBin));
  const counts = deps.tableCounts ?? tableCounts;
  const tmp = await mkdtemp(join(tmpdir(), "mcbk-"));
  const summary = { at: now.toISOString(), ok: false, db: null, files: null, error: null };
  try {
    await ping(cfg.pingUrl, "/start");
    const before = await counts(cfg.databaseUrl);
    const plain = join(tmp, "db.dump");
    await dump(cfg.databaseUrl, plain);
    const plainHash = await sha256(plain);
    const plainSize = (await stat(plain)).size;
    const enc = join(tmp, "db.dump.enc");
    await encryptTo(createReadStream(plain), enc, cfg.passphrase);
    const key = dumpKey(now);
    await storage.put(key, enc);
    const meta = { format: 1, createdAt: now.toISOString(), serverVersion: before.serverVersion, tables: before.counts, dumpBytes: plainSize, encryptedBytes: (await stat(enc)).size, sha256: plainHash };
    await storage.putBuffer(key.replace(/\.dump\.enc$/, ".meta.json"), Buffer.from(JSON.stringify(meta)));
    summary.db = { key, bytes: meta.encryptedBytes, tables: Object.keys(before.counts).length };
    log(`banco: ${key} (${meta.encryptedBytes} bytes, ${summary.db.tables} tabelas)`);

    const expired = selectExpired((await storage.list("db/")).map((i) => i.key), now, cfg.retentionDays);
    for (const k of expired) {
      await storage.remove(k);
      await storage.remove(k.replace(/\.dump\.enc$/, ".meta.json"));
    }
    if (expired.length) log(`banco: ${expired.length} backup(s) antigo(s) removido(s)`);

    if (cfg.appwrite || deps.fileSource) {
      summary.files = await syncFiles({ source: deps.fileSource ?? appwriteSource(cfg.appwrite), storage, passphrase: cfg.passphrase, now, log });
    } else log("fotos: Appwrite não configurado, nada copiado");
    summary.ok = true;
    return summary;
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await storage.putBuffer(LAST_RUN, Buffer.from(JSON.stringify(summary))).catch(() => {});
    await ping(cfg.pingUrl, summary.ok ? "" : "/fail");
  }
}

/** Hora de rodar? Já passou das `at` (no fuso) e ainda não rodou hoje. */
export function isDue(now, tz, at, lastDate) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { due: `${p.hour}:${p.minute}` >= at && lastDate !== date, date };
}
