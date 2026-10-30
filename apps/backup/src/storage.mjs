// Armazenamento dos backups: Cloudflare R2 (API S3) ou uma pasta local (testes e emergência).
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";

/** @typedef {{ key: string, size: number, lastModified: Date }} Item */

class S3Storage {
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey }) {
    this.bucket = bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      // o R2 não aceita os checksums extras que as versões novas do SDK mandam por padrão
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(key, localPath) {
    const { size } = await stat(localPath);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(localPath), ContentLength: size }));
  }

  async putBuffer(key, buf) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentLength: buf.length }));
  }

  async get(key, destPath) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    await mkdir(dirname(destPath), { recursive: true });
    await pipeline(out.Body, createWriteStream(destPath));
  }

  async getBuffer(key) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async exists(key) {
    return (await this.list(key)).some((i) => i.key === key);
  }

  /** @returns {Promise<Item[]>} */
  async list(prefix) {
    const items = [];
    let token;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) items.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return items;
  }

  async remove(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

class LocalStorage {
  constructor({ dir }) {
    this.dir = dir;
  }

  path(key) {
    return join(this.dir, ...key.split("/"));
  }

  async put(key, localPath) {
    await mkdir(dirname(this.path(key)), { recursive: true });
    await copyFile(localPath, this.path(key));
  }

  async putBuffer(key, buf) {
    await mkdir(dirname(this.path(key)), { recursive: true });
    await writeFile(this.path(key), buf);
  }

  async get(key, destPath) {
    await mkdir(dirname(destPath), { recursive: true });
    await copyFile(this.path(key), destPath);
  }

  async getBuffer(key) {
    return readFile(this.path(key));
  }

  async exists(key) {
    return stat(this.path(key)).then(() => true, () => false);
  }

  async list(prefix) {
    const items = [];
    const walk = async (d) => {
      for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else {
          const key = relative(this.dir, p).split(sep).join("/");
          if (key.startsWith(prefix)) {
            const s = await stat(p);
            items.push({ key, size: s.size, lastModified: s.mtime });
          }
        }
      }
    };
    await walk(this.dir);
    return items;
  }

  async remove(key) {
    await rm(this.path(key), { force: true });
  }
}

export function createStorage(cfg) {
  return cfg.kind === "s3" ? new S3Storage(cfg) : new LocalStorage(cfg);
}
