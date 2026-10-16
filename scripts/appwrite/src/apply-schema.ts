/**
 * Cria (ou completa) o banco do MedCuidar no Appwrite a partir de `COLLECTIONS`.
 * Idempotente: rodar de novo só cria o que falta e nunca apaga nada.
 *
 * Acesso: todo acesso aos dados passa pelo servidor (chave de API) com filtro por family_id.
 * Por isso as coleções não dão permissão a clientes e usam segurança por documento; cada
 * documento criado pelo servidor recebe permissão de leitura do Team da família (defesa em profundidade).
 */
import { COLLECTIONS, type AttrSpec, type CollectionSpec } from "@medcuidar/shared";
import { DatabasesIndexType as IndexType } from "node-appwrite";
import { createClients, isStatus, sleep } from "./client";

type Ctx = ReturnType<typeof createClients>;

async function ensureDatabase({ databases, databaseId }: Ctx) {
  try {
    await databases.get(databaseId);
    log(`banco "${databaseId}" já existe`);
  } catch (err) {
    if (!isStatus(err, 404)) throw err;
    await databases.create(databaseId, "MedCuidar");
    log(`banco "${databaseId}" criado`);
  }
}

async function ensureCollection({ databases, databaseId }: Ctx, c: CollectionSpec) {
  try {
    await databases.getCollection(databaseId, c.id);
    return false;
  } catch (err) {
    if (!isStatus(err, 404)) throw err;
    // sem permissões de coleção: só o servidor acessa; documentSecurity ligado.
    await databases.createCollection(databaseId, c.id, c.name, [], true);
    log(`coleção ${c.id} criada`);
    return true;
  }
}

async function existingAttributeKeys({ databases, databaseId }: Ctx, collectionId: string) {
  const list = await databases.listAttributes(databaseId, collectionId);
  return new Map(list.attributes.map((a) => [(a as { key: string }).key, a as { key: string; status: string }]));
}

async function createAttribute({ databases, databaseId }: Ctx, collectionId: string, a: AttrSpec) {
  const required = a.required;
  const array = a.array ?? false;
  const def = required ? undefined : (a.default ?? undefined);
  switch (a.type) {
    case "string":
      return databases.createStringAttribute(databaseId, collectionId, a.key, a.size ?? 255, required, def as string | undefined, array);
    case "integer":
      return databases.createIntegerAttribute(databaseId, collectionId, a.key, required, undefined, undefined, def as number | undefined, array);
    case "float":
      return databases.createFloatAttribute(databaseId, collectionId, a.key, required, undefined, undefined, def as number | undefined, array);
    case "boolean":
      return databases.createBooleanAttribute(databaseId, collectionId, a.key, required, def as boolean | undefined, array);
    case "datetime":
      return databases.createDatetimeAttribute(databaseId, collectionId, a.key, required, def as string | undefined, array);
    case "enum":
      return databases.createEnumAttribute(databaseId, collectionId, a.key, [...(a.elements ?? [])], required, def as string | undefined, array);
  }
}

async function waitAttributesAvailable(ctx: Ctx, collectionId: string, keys: string[]) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const have = await existingAttributeKeys(ctx, collectionId);
    const pending = keys.filter((k) => have.get(k)?.status !== "available");
    if (pending.length === 0) return;
    const failed = keys.filter((k) => have.get(k)?.status === "failed");
    if (failed.length) throw new Error(`Atributos falharam em ${collectionId}: ${failed.join(", ")}`);
    await sleep(500);
  }
  throw new Error(`Tempo esgotado esperando atributos de ${collectionId}`);
}

async function ensureAttributes(ctx: Ctx, c: CollectionSpec) {
  const have = await existingAttributeKeys(ctx, c.id);
  const missing = c.attributes.filter((a) => !have.has(a.key));
  for (const a of missing) await createAttribute(ctx, c.id, a);
  if (missing.length) log(`  ${c.id}: ${missing.length} atributo(s) criado(s)`);
  await waitAttributesAvailable(ctx, c.id, c.attributes.map((a) => a.key));
}

async function ensureIndexes({ databases, databaseId }: Ctx, c: CollectionSpec) {
  const list = await databases.listIndexes(databaseId, c.id);
  const have = new Set(list.indexes.map((i) => (i as { key: string }).key));
  const typeMap = { key: IndexType.Key, unique: IndexType.Unique, fulltext: IndexType.Fulltext } as const;
  let created = 0;
  for (const i of c.indexes) {
    if (have.has(i.key)) continue;
    await databases.createIndex(databaseId, c.id, i.key, typeMap[i.type], [...i.attributes]);
    created++;
    // índices são processados em fila; pequena pausa evita rejeição por concorrência
    await sleep(300);
  }
  if (created) log(`  ${c.id}: ${created} índice(s) criado(s)`);
}

function log(msg: string) {
  console.error(`[schema] ${msg}`);
}

export async function applySchema(ctx = createClients()) {
  await ensureDatabase(ctx);
  for (const c of COLLECTIONS) {
    await ensureCollection(ctx, c);
    await ensureAttributes(ctx, c);
    await ensureIndexes(ctx, c);
  }
  log(`concluído: ${COLLECTIONS.length} coleções`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("apply-schema.ts")) {
  applySchema().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
