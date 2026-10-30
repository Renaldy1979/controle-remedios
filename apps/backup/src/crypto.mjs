// Criptografia dos backups: AES-256-GCM com chave derivada da senha (scrypt). Arquivo = MAGIC | salt | iv | cifrado | tag.
// Os 33 primeiros bytes (cabeçalho) entram como dado autenticado: adulterar qualquer parte faz a leitura falhar.
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("MCBK1");
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;

const deriveKey = (passphrase, salt) =>
  new Promise((resolve, reject) =>
    scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))),
  );

function checkPassphrase(passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < 16) throw new Error("A chave de criptografia precisa ter ao menos 16 caracteres.");
}

/** Criptografa `source` (Buffer ou Readable) para o arquivo `destPath`. */
export async function encryptTo(source, destPath, passphrase) {
  checkPassphrase(passphrase);
  const salt = randomBytes(SALT);
  const iv = randomBytes(IV);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
  cipher.setAAD(header);
  const input = Buffer.isBuffer(source) ? Readable.from([source]) : source;
  async function* generate() {
    yield header;
    for await (const chunk of input) yield cipher.update(chunk);
    yield cipher.final();
    yield cipher.getAuthTag();
  }
  await pipeline(Readable.from(generate()), createWriteStream(destPath));
}

/** Descriptografa o arquivo `srcPath` para `destPath`. Chave errada ou arquivo alterado: erro, e nada fica gravado. */
export async function decryptTo(srcPath, destPath, passphrase) {
  checkPassphrase(passphrase);
  const { size } = await stat(srcPath);
  if (size < HEADER + TAG) throw new Error("Arquivo de backup inválido (pequeno demais).");
  const fh = await open(srcPath, "r");
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER);
    await fh.read(header, 0, HEADER, 0);
    tag = Buffer.alloc(TAG);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Arquivo de backup inválido (formato desconhecido).");
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT);
  const iv = header.subarray(MAGIC.length + SALT);
  const decipher = createDecipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(srcPath, { start: HEADER, end: size - TAG - 1 }), decipher, createWriteStream(destPath));
  } catch {
    await rm(destPath, { force: true });
    throw new Error("Não foi possível abrir o backup: a chave está errada ou o arquivo foi alterado.");
  }
}
