// Fotos de receita (bucket do Appwrite): cópia incremental e criptografada. O arquivo é imutável, então só envia o que ainda não existe.
import { Client, Query, Storage } from "node-appwrite";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptTo, encryptTo } from "./crypto.mjs";

const MISSING_STATE = "state/files-missing.json";
export const PRUNE_AFTER_DAYS = 35;

/** Cliente fino do Appwrite (injetável nos testes). */
export function appwriteSource(cfg) {
  const storage = new Storage(new Client().setEndpoint(cfg.endpoint).setProject(cfg.projectId).setKey(cfg.apiKey));
  return {
    async list() {
      const out = [];
      for (let offset = 0; ; offset += 100) {
        const page = await storage.listFiles({ bucketId: cfg.bucketId, queries: [Query.limit(100), Query.offset(offset)] });
        out.push(...page.files.map((f) => ({ id: f.$id, name: f.name, mimeType: f.mimeType, size: f.sizeOriginal })));
        if (page.files.length < 100) return out;
      }
    },
    async download(id) {
      return Buffer.from(await storage.getFileDownload({ bucketId: cfg.bucketId, fileId: id }));
    },
    async upload(id, name, bytes) {
      const { InputFile } = await import("node-appwrite/file");
      await storage.createFile({ bucketId: cfg.bucketId, fileId: id, file: InputFile.fromBuffer(bytes, name), permissions: [] });
    },
  };
}

/**
 * Envia ao armazenamento de backup as fotos que ainda não estão lá. Fotos apagadas no Appwrite saem do backup só
 * depois de 35 dias sumidas (dá tempo de perceber um apagamento por engano). Se a listagem falhar, não apaga nada.
 */
export async function syncFiles({ source, storage, passphrase, now = new Date(), log = () => {} }) {
  const live = await source.list();
  const liveIds = new Set(live.map((f) => f.id));
  const existing = new Set((await storage.list("files/")).filter((i) => i.key.endsWith(".enc")).map((i) => i.key.slice(6, -4)));

  let uploaded = 0;
  const tmp = await mkdtemp(join(tmpdir(), "mcbk-files-"));
  try {
    for (const f of live) {
      if (existing.has(f.id)) continue;
      const bytes = await source.download(f.id);
      const enc = join(tmp, `${f.id}.enc`);
      await encryptTo(bytes, enc, passphrase);
      await storage.put(`files/${f.id}.enc`, enc);
      const meta = { id: f.id, name: f.name, mimeType: f.mimeType, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), savedAt: now.toISOString() };
      await storage.putBuffer(`files/${f.id}.meta.json`, Buffer.from(JSON.stringify(meta)));
      uploaded++;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  // apagadas no Appwrite: carência de 35 dias antes de sair do backup
  let missing = {};
  if (await storage.exists(MISSING_STATE)) missing = JSON.parse((await storage.getBuffer(MISSING_STATE)).toString("utf8"));
  const next = {};
  let pruned = 0;
  for (const id of existing) {
    if (liveIds.has(id)) continue;
    const since = missing[id] ?? now.toISOString();
    if (now.getTime() - Date.parse(since) >= PRUNE_AFTER_DAYS * 86_400_000) {
      await storage.remove(`files/${id}.enc`);
      await storage.remove(`files/${id}.meta.json`);
      pruned++;
    } else next[id] = since;
  }
  await storage.putBuffer(MISSING_STATE, Buffer.from(JSON.stringify(next)));
  log(`fotos: ${live.length} no Appwrite, ${uploaded} enviadas, ${pruned} removidas do backup`);
  return { total: live.length, uploaded, pruned };
}

/** Devolve ao Appwrite as fotos do backup que não existirem lá, com o MESMO id (o banco aponta por id). */
export async function restoreFiles({ source, storage, passphrase, dryRun = false, log = () => {} }) {
  const live = new Set((await source.list()).map((f) => f.id));
  const metas = (await storage.list("files/")).filter((i) => i.key.endsWith(".meta.json"));
  const tmp = await mkdtemp(join(tmpdir(), "mcbk-restore-"));
  let restored = 0;
  let skipped = 0;
  try {
    for (const m of metas) {
      const meta = JSON.parse((await storage.getBuffer(m.key)).toString("utf8"));
      if (live.has(meta.id)) { skipped++; continue; }
      if (dryRun) { restored++; continue; }
      const enc = join(tmp, `${meta.id}.enc`);
      const plain = join(tmp, `${meta.id}.bin`);
      await storage.get(`files/${meta.id}.enc`, enc);
      await decryptTo(enc, plain, passphrase);
      const bytes = await readFile(plain);
      if (createHash("sha256").update(bytes).digest("hex") !== meta.sha256) throw new Error(`Foto ${meta.id}: conferência (sha256) falhou.`);
      await source.upload(meta.id, meta.name, bytes);
      restored++;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  log(`fotos: ${restored} ${dryRun ? "seriam restauradas" : "restauradas"}, ${skipped} já existiam`);
  return { restored, skipped };
}
