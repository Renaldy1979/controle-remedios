import { Client, Databases, Query, Storage, Teams, Users } from "node-appwrite";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ausente: ${name}. Veja .env.example.`);
  return v;
}

export function createClients() {
  const client = new Client()
    .setEndpoint(env("APPWRITE_ENDPOINT"))
    .setProject(env("APPWRITE_PROJECT_ID"))
    .setKey(env("APPWRITE_API_KEY"));
  return {
    client,
    databases: new Databases(client),
    teams: new Teams(client),
    users: new Users(client),
    storage: new Storage(client),
    databaseId: env("APPWRITE_DATABASE_ID"),
  };
}

export { Query };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Appwrite responde 404 para recurso inexistente e 409 para já existente. */
export function isStatus(err: unknown, code: number): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === code;
}
