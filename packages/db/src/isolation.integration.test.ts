/**
 * Prova de isolamento entre famílias contra um Appwrite real.
 * Cria 2 famílias (Teams) e 2 usuários de teste, tenta cruzar os dados e remove tudo no fim.
 * Rodar: `pnpm --filter @medcuidar/db test:integration` (usa o .env da raiz).
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Databases, ID, Teams, Users } from "node-appwrite";
import { FamilyScopedDb, FamilyScopeError } from "./scoped";

const need = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n} no .env`);
  return v;
};

const endpoint = need("APPWRITE_ENDPOINT");
const projectId = need("APPWRITE_PROJECT_ID");
const databaseId = need("APPWRITE_DATABASE_ID");
const server = new Client().setEndpoint(endpoint).setProject(projectId).setKey(need("APPWRITE_API_KEY"));
const serverDb = new Databases(server);
const teams = new Teams(server);
const users = new Users(server);

interface Family {
  teamId: string;
  userId: string;
  patientId: string;
  scoped: FamilyScopedDb;
  userDb: Databases;
}

const created = { teams: [] as string[], users: [] as string[], patients: [] as string[] };

async function makeFamily(label: string): Promise<Family> {
  const tag = randomBytes(4).toString("hex");
  const teamId = `zz-test-${label}-${tag}`;
  await teams.create(teamId, `Teste ${label}`);
  created.teams.push(teamId);

  const userId = ID.unique();
  const email = `zz-${label}-${tag}@medcuidar.invalid`;
  await users.create(userId, email, undefined, randomBytes(12).toString("base64url"), `Teste ${label}`);
  created.users.push(userId);
  await teams.createMembership(teamId, ["member"], undefined, userId);

  const scoped = new FamilyScopedDb(serverDb, databaseId, teamId);
  const patientId = `zz-p-${label}-${tag}`;
  await scoped.create("patients", { name: `Paciente ${label}`, can_use_phone: true, active: true }, patientId);
  created.patients.push(patientId);

  const session = await users.createSession(userId);
  const jwt = await users.createJWT(userId, session.$id, 600);
  const userDb = new Databases(new Client().setEndpoint(endpoint).setProject(projectId).setJWT(jwt.jwt));
  return { teamId, userId, patientId, scoped, userDb };
}

let A: Family;
let B: Family;

beforeAll(async () => {
  A = await makeFamily("a");
  B = await makeFamily("b");
});

afterAll(async () => {
  for (const id of created.patients) await serverDb.deleteDocument(databaseId, "patients", id).catch(() => {});
  for (const id of created.teams) await teams.delete(id).catch(() => {});
  for (const id of created.users) await users.delete(id).catch(() => {});
});

describe("isolamento entre famílias (Appwrite real)", () => {
  it("camada de aplicação: família A não lê, altera nem apaga dado da família B", async () => {
    await expect(A.scoped.get("patients", B.patientId)).rejects.toBeInstanceOf(FamilyScopeError);
    await expect(A.scoped.update("patients", B.patientId, { name: "invasão" })).rejects.toBeInstanceOf(FamilyScopeError);
    await expect(A.scoped.remove("patients", B.patientId)).rejects.toBeInstanceOf(FamilyScopeError);
    const stillB = await B.scoped.get("patients", B.patientId);
    expect(stillB["name"]).toBe("Paciente b");
  });

  it("camada de aplicação: listagem de A traz só dados de A", async () => {
    const list = await A.scoped.list("patients");
    const ids = list.documents.map((d) => d.$id);
    expect(ids).toContain(A.patientId);
    expect(ids).not.toContain(B.patientId);
  });

  it("banco: usuário da família A lê o próprio paciente", async () => {
    const doc = await A.userDb.getDocument(databaseId, "patients", A.patientId);
    expect(doc.$id).toBe(A.patientId);
  });

  it("banco: usuário da família A NÃO lê o paciente da família B (permissão por Team)", async () => {
    await expect(B.userDb.getDocument(databaseId, "patients", A.patientId)).rejects.toMatchObject({
      code: expect.any(Number),
    });
    await expect(A.userDb.getDocument(databaseId, "patients", B.patientId)).rejects.toMatchObject({
      code: expect.any(Number),
    });
  });

  it("banco: usuário de A não consegue escrever nem apagar dados de B", async () => {
    await expect(
      A.userDb.updateDocument(databaseId, "patients", B.patientId, { name: "invasão" }),
    ).rejects.toBeDefined();
    await expect(A.userDb.deleteDocument(databaseId, "patients", B.patientId)).rejects.toBeDefined();
    const doc = await B.scoped.get("patients", B.patientId);
    expect(doc["name"]).toBe("Paciente b");
  });

  it("banco: usuário de A não cria documento direto (coleção sem permissão de cliente)", async () => {
    await expect(
      A.userDb.createDocument(databaseId, "patients", ID.unique(), {
        family_id: A.teamId,
        name: "x",
        can_use_phone: true,
        active: true,
      }),
    ).rejects.toBeDefined();
  });

  it("banco: listagem do usuário de A não vaza documentos de B", async () => {
    const list = await A.userDb.listDocuments(databaseId, "patients").catch(() => ({ documents: [] as { $id: string }[] }));
    const ids = list.documents.map((d) => d.$id);
    expect(ids).not.toContain(B.patientId);
  });
});
