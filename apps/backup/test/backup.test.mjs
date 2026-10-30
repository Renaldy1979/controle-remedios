import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.mjs";
import { decryptTo, encryptTo } from "../src/crypto.mjs";
import { compareCounts, pgEnv } from "../src/db.mjs";
import { PRUNE_AFTER_DAYS, restoreFiles, syncFiles } from "../src/files.mjs";
import { listBackups } from "../src/restore.mjs";
import { LAST_RUN, backupOnce, dumpKey, isDue, selectExpired, stampDate } from "../src/run.mjs";
import { createStorage } from "../src/storage.mjs";

const KEY = "uma-senha-de-teste-bem-comprida";
let dir;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "mcbk-test-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("criptografia", () => {
  it("abre o que cifrou e não deixa o texto original à vista", async () => {
    const original = Buffer.from("dado de saúde ".repeat(5000));
    await encryptTo(original, join(dir, "a.enc"), KEY);
    const cifrado = await readFile(join(dir, "a.enc"));
    expect(cifrado.includes(Buffer.from("dado de saúde"))).toBe(false);
    await decryptTo(join(dir, "a.enc"), join(dir, "a.out"), KEY);
    expect((await readFile(join(dir, "a.out"))).equals(original)).toBe(true);
  });

  it("chave errada, arquivo alterado e arquivo truncado são recusados e não deixam saída", async () => {
    await encryptTo(Buffer.from("segredo"), join(dir, "a.enc"), KEY);
    await expect(decryptTo(join(dir, "a.enc"), join(dir, "x.out"), "outra-senha-bem-comprida-aqui")).rejects.toThrow(/chave está errada ou o arquivo foi alterado/);
    await expect(readFile(join(dir, "x.out"))).rejects.toThrow();

    const bytes = await readFile(join(dir, "a.enc"));
    bytes[bytes.length - 20] ^= 0xff; // adultera o conteúdo cifrado
    await writeFile(join(dir, "b.enc"), bytes);
    await expect(decryptTo(join(dir, "b.enc"), join(dir, "b.out"), KEY)).rejects.toThrow(/alterado/);

    await writeFile(join(dir, "c.enc"), bytes.subarray(0, 10));
    await expect(decryptTo(join(dir, "c.enc"), join(dir, "c.out"), KEY)).rejects.toThrow(/inválido/);
  });

  it("recusa chave curta", async () => {
    await expect(encryptTo(Buffer.from("x"), join(dir, "a.enc"), "curta")).rejects.toThrow(/ao menos 16/);
  });
});

describe("nomes, retenção e horário", () => {
  it("o nome do backup carrega a data e volta a ser lida", () => {
    const d = new Date("2026-10-30T06:00:05Z");
    expect(dumpKey(d)).toBe("db/2026/10/medcuidar-20261030-060005.dump.enc");
    expect(stampDate(dumpKey(d))).toEqual(d);
    expect(stampDate("db/2026/10/outra-coisa.json")).toBeNull();
  });

  it("vence quem passou de N dias, mas preserva sempre os 3 mais recentes", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const keys = [0, 1, 2, 29, 31, 40].map((dias) => dumpKey(new Date(now.getTime() - dias * 86_400_000)));
    const expiradas = selectExpired(keys, now, 30);
    expect(expiradas).toEqual([dumpKey(new Date(now.getTime() - 40 * 86_400_000)), dumpKey(new Date(now.getTime() - 31 * 86_400_000))].sort((a, b) => stampDate(b) - stampDate(a)));
    // só 3 backups, todos velhos: nenhum é apagado
    const velhos = [60, 70, 80].map((dias) => dumpKey(new Date(now.getTime() - dias * 86_400_000)));
    expect(selectExpired(velhos, now, 30)).toEqual([]);
  });

  it("roda uma vez por dia, depois do horário, no fuso de São Paulo", () => {
    // 06:00 UTC = 03:00 em São Paulo
    expect(isDue(new Date("2026-10-30T05:59:00Z"), "America/Sao_Paulo", "03:00", null).due).toBe(false);
    const r = isDue(new Date("2026-10-30T06:00:00Z"), "America/Sao_Paulo", "03:00", null);
    expect(r).toEqual({ due: true, date: "2026-10-30" });
    expect(isDue(new Date("2026-10-30T09:00:00Z"), "America/Sao_Paulo", "03:00", "2026-10-30").due).toBe(false);
    expect(isDue(new Date("2026-10-31T06:30:00Z"), "America/Sao_Paulo", "03:00", "2026-10-30").due).toBe(true);
  });
});

describe("configuração", () => {
  it("diz o NOME das variáveis que faltam, nunca os valores", () => {
    expect(() => loadConfig({ BACKUP_STORAGE: "s3", DATABASE_URL_BACKUP: "postgres://u:senha-secreta@h/db" })).toThrow(/BACKUP_ENCRYPTION_KEY.*BACKUP_S3_ENDPOINT/);
    try { loadConfig({ DATABASE_URL_BACKUP: "postgres://u:senha-secreta@h/db" }); } catch (e) { expect(e.message).not.toContain("senha-secreta"); }
  });
  it("valida horário e retenção, e o Appwrite é opcional", () => {
    const base = { BACKUP_STORAGE: "local", BACKUP_LOCAL_DIR: "/tmp/x", DATABASE_URL_BACKUP: "postgres://u:p@h/db", BACKUP_ENCRYPTION_KEY: KEY };
    expect(() => loadConfig({ ...base, BACKUP_AT: "25:00" })).toThrow(/HH:mm/);
    expect(() => loadConfig({ ...base, BACKUP_RETENTION_DAYS: "3" })).toThrow(/pelo menos 7/);
    expect(loadConfig(base)).toMatchObject({ at: "03:00", retentionDays: 30, appwrite: null });
  });
  it("a senha do banco vai por variável de ambiente, não na linha de comando", () => {
    expect(pgEnv("postgres://dono:p%40ss@db.interno:5433/medcuidar?sslmode=require")).toEqual({
      PGHOST: "db.interno", PGPORT: "5433", PGUSER: "dono", PGPASSWORD: "p@ss", PGDATABASE: "medcuidar", PGSSLMODE: "require",
    });
  });
});

describe("conferência da restauração", () => {
  it("igual = ok; número diferente avisa; tabela faltando ou vazia é grave", () => {
    expect(compareCounts({ a: 2, b: 0 }, { a: 2, b: 0 })).toMatchObject({ identical: true, fatal: false });
    expect(compareCounts({ a: 2 }, { a: 3 })).toMatchObject({ identical: false, fatal: false });
    expect(compareCounts({ a: 2 }, {})).toMatchObject({ fatal: true });
    expect(compareCounts({ a: 2 }, { a: 0 })).toMatchObject({ fatal: true });
  });
});

describe("rodada de backup (armazenamento local e dump de mentira)", () => {
  const cfgBase = () => ({
    databaseUrl: "postgres://u:p@h/db", passphrase: KEY, retentionDays: 30, pingUrl: null, pgDumpBin: "pg_dump", appwrite: null,
  });
  const deps = (extra = {}) => ({
    dumpDatabase: async (_url, out) => writeFile(out, "DUMP-FALSO-DO-BANCO"),
    tableCounts: async () => ({ counts: { families: 1, members: 3 }, serverVersion: "16.4" }),
    ...extra,
  });

  it("envia o dump criptografado com resumo, registra a rodada e o backup abre de volta", async () => {
    const storage = createStorage({ kind: "local", dir });
    const now = new Date("2026-10-30T06:00:00Z");
    const res = await backupOnce(cfgBase(), storage, { now, log: () => {}, deps: deps() });
    expect(res.ok).toBe(true);

    const lista = await listBackups(storage);
    expect(lista).toHaveLength(1);
    expect(lista[0].meta.tables).toEqual({ families: 1, members: 3 });
    expect(lista[0].meta.sha256).toBe(createHash("sha256").update("DUMP-FALSO-DO-BANCO").digest("hex"));

    await storage.get(lista[0].key, join(dir, "baixado.enc"));
    await decryptTo(join(dir, "baixado.enc"), join(dir, "baixado.dump"), KEY);
    expect(await readFile(join(dir, "baixado.dump"), "utf8")).toBe("DUMP-FALSO-DO-BANCO");
    expect(JSON.parse((await storage.getBuffer(LAST_RUN)).toString("utf8"))).toMatchObject({ ok: true });
  });

  it("remove os vencidos (com o resumo) e preserva os recentes", async () => {
    const storage = createStorage({ kind: "local", dir });
    const hoje = new Date("2026-10-30T06:00:00Z");
    for (const dias of [45, 40, 35, 5, 4]) await backupOnce(cfgBase(), storage, { now: new Date(hoje.getTime() - dias * 86_400_000), log: () => {}, deps: deps() });
    await backupOnce(cfgBase(), storage, { now: hoje, log: () => {}, deps: deps() });
    const chaves = (await storage.list("db/")).map((i) => i.key);
    expect(chaves.filter((k) => k.endsWith(".dump.enc"))).toHaveLength(3); // 5, 4 e hoje (os de 35+ dias saíram)
    expect(chaves.filter((k) => k.endsWith(".meta.json"))).toHaveLength(3);
  });

  it("falha do dump: registra a falha, relança o erro e não deixa backup pela metade", async () => {
    const storage = createStorage({ kind: "local", dir });
    await expect(backupOnce(cfgBase(), storage, { now: new Date(), log: () => {}, deps: deps({ dumpDatabase: async () => { throw new Error("pg_dump quebrou"); } }) })).rejects.toThrow("pg_dump quebrou");
    expect((await storage.list("db/")).length).toBe(0);
    expect(JSON.parse((await storage.getBuffer(LAST_RUN)).toString("utf8"))).toMatchObject({ ok: false, error: "pg_dump quebrou" });
  });
});

describe("fotos de receita", () => {
  const fonte = (arquivos) => ({
    arquivos: new Map(arquivos.map((a) => [a.id, a])),
    list: async function () { return [...this.arquivos.values()].map(({ id, name, mimeType }) => ({ id, name, mimeType })); },
    download: async function (id) { return this.arquivos.get(id).bytes; },
    upload: async function (id, name, bytes) { this.arquivos.set(id, { id, name, mimeType: "image/jpeg", bytes }); },
  });
  const foto = (id) => ({ id, name: `rx-${id}.jpg`, mimeType: "image/jpeg", bytes: Buffer.from(`bytes-da-foto-${id}`) });

  it("envia só as novas, criptografadas, com o resumo; repetir não reenvia", async () => {
    const storage = createStorage({ kind: "local", dir });
    const source = fonte([foto("f1"), foto("f2")]);
    expect(await syncFiles({ source, storage, passphrase: KEY, log: () => {} })).toMatchObject({ total: 2, uploaded: 2, pruned: 0 });
    source.arquivos.set("f3", foto("f3"));
    expect(await syncFiles({ source, storage, passphrase: KEY, log: () => {} })).toMatchObject({ total: 3, uploaded: 1 });
    expect((await readFile(join(dir, "files", "f1.enc"))).includes(Buffer.from("bytes-da-foto-f1"))).toBe(false);
  });

  it("foto apagada no Appwrite só sai do backup depois de 35 dias; se voltar, a contagem zera", async () => {
    const storage = createStorage({ kind: "local", dir });
    const source = fonte([foto("f1"), foto("f2")]);
    const dia0 = new Date("2026-10-01T00:00:00Z");
    await syncFiles({ source, storage, passphrase: KEY, now: dia0, log: () => {} });
    source.arquivos.delete("f2");
    await syncFiles({ source, storage, passphrase: KEY, now: dia0, log: () => {} });
    const dia34 = new Date(dia0.getTime() + 34 * 86_400_000);
    expect((await syncFiles({ source, storage, passphrase: KEY, now: dia34, log: () => {} })).pruned).toBe(0);
    const dia36 = new Date(dia0.getTime() + (PRUNE_AFTER_DAYS + 1) * 86_400_000);
    expect((await syncFiles({ source, storage, passphrase: KEY, now: dia36, log: () => {} })).pruned).toBe(1);
    expect(await storage.exists("files/f2.enc")).toBe(false);
    expect(await storage.exists("files/f1.enc")).toBe(true);
  });

  it("se a listagem do Appwrite falhar, não apaga nada do backup", async () => {
    const storage = createStorage({ kind: "local", dir });
    const source = fonte([foto("f1")]);
    await syncFiles({ source, storage, passphrase: KEY, log: () => {} });
    source.list = async () => { throw new Error("Appwrite fora do ar"); };
    await expect(syncFiles({ source, storage, passphrase: KEY, now: new Date("2027-01-01T00:00:00Z"), log: () => {} })).rejects.toThrow("Appwrite fora do ar");
    expect(await storage.exists("files/f1.enc")).toBe(true);
  });

  it("restaura no Appwrite com o mesmo id, confere o sha256 e não mexe no que já existe", async () => {
    const storage = createStorage({ kind: "local", dir });
    const origem = fonte([foto("f1"), foto("f2")]);
    await syncFiles({ source: origem, storage, passphrase: KEY, log: () => {} });
    const destino = fonte([foto("f1")]); // o Appwrite novo só tem a f1
    const seco = await restoreFiles({ source: destino, storage, passphrase: KEY, dryRun: true, log: () => {} });
    expect(seco).toEqual({ restored: 1, skipped: 1 });
    expect(destino.arquivos.has("f2")).toBe(false);
    await restoreFiles({ source: destino, storage, passphrase: KEY, log: () => {} });
    expect(destino.arquivos.get("f2").bytes.toString()).toBe("bytes-da-foto-f2");
  });
});
