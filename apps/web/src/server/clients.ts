import "server-only";
import { FamilyScopedDb } from "@medcuidar/db";
import { Client, Databases, Storage } from "node-appwrite";
import { appwriteEnv } from "./env";

interface Clients {
  databases: Databases;
  storage: Storage;
  databaseId: string;
}

const g = globalThis as unknown as { __mcClients?: Clients };

export function clients(): Clients {
  if (!g.__mcClients) {
    const e = appwriteEnv();
    const client = new Client().setEndpoint(e.endpoint).setProject(e.projectId).setKey(e.apiKey);
    g.__mcClients = { databases: new Databases(client), storage: new Storage(client), databaseId: e.databaseId };
  }
  return g.__mcClients;
}

/** Único caminho para dados de família: sempre preso a UM familyId (vindo da sessão, nunca do cliente). */
export function familyDb(familyId: string): FamilyScopedDb {
  const c = clients();
  return new FamilyScopedDb(c.databases, c.databaseId, familyId);
}
