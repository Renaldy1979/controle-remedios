import { Query, type Databases } from "node-appwrite";
import { FamilyScopedDb } from "@medcuidar/db";
import type { FamilyData, FamilyInfo, FindOptions, GlobalData, Row, Where } from "../ports";
import { parseSettings } from "../rows";

const DEFAULT_LIMIT = 100;

/** Converte o filtro das portas em queries do Appwrite. Exportado para teste. */
export function whereToQueries(where: Where = {}, options: FindOptions = {}): string[] {
  const q: string[] = [];
  for (const [field, cond] of Object.entries(where)) {
    if (typeof cond !== "object") {
      q.push(Query.equal(field, [cond]));
      continue;
    }
    if ("in" in cond) {
      q.push(Query.equal(field, cond.in));
      continue;
    }
    if (cond.ne !== undefined) q.push(Query.notEqual(field, cond.ne));
    if (cond.lt !== undefined) q.push(Query.lessThan(field, cond.lt));
    if (cond.lte !== undefined) q.push(Query.lessThanEqual(field, cond.lte));
    if (cond.gt !== undefined) q.push(Query.greaterThan(field, cond.gt));
    if (cond.gte !== undefined) q.push(Query.greaterThanEqual(field, cond.gte));
  }
  if (options.orderBy) q.push(options.order === "desc" ? Query.orderDesc(options.orderBy) : Query.orderAsc(options.orderBy));
  q.push(Query.limit(options.limit ?? DEFAULT_LIMIT));
  return q;
}

const isNotFound = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: number }).code === 404;

/** Dados de uma família via `FamilyScopedDb` (nunca `Databases` direto para dados de família). */
export class AppwriteFamilyData implements FamilyData {
  constructor(private readonly db: FamilyScopedDb) {}

  get familyId() {
    return this.db.familyId;
  }
  create(collection: string, data: Record<string, unknown>, id?: string) {
    return this.db.create(collection, data, id) as Promise<Row>;
  }
  get(collection: string, id: string) {
    return this.db.get(collection, id) as Promise<Row>;
  }
  async getOrNull(collection: string, id: string) {
    try {
      return (await this.db.get(collection, id)) as Row;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  async find(collection: string, where?: Where, options?: FindOptions) {
    const res = await this.db.list(collection, whereToQueries(where, options));
    return res.documents as unknown as Row[];
  }
  update(collection: string, id: string, data: Record<string, unknown>) {
    return this.db.update(collection, id, data) as Promise<Row>;
  }
}

type GlobalDb = Pick<Databases, "createDocument" | "listDocuments" | "updateDocument">;

/** Coleções globais (`families`, `login_codes`) — as únicas que usam `Databases` direto. */
export class AppwriteGlobalData implements GlobalData {
  constructor(
    private readonly databases: GlobalDb,
    private readonly databaseId: string,
    private readonly newId: () => string,
  ) {}

  async listFamilies(): Promise<FamilyInfo[]> {
    const out: FamilyInfo[] = [];
    let cursor: string | undefined;
    for (;;) {
      const queries = [Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])];
      const page = await this.databases.listDocuments(this.databaseId, "families", queries);
      for (const doc of page.documents) {
        if (doc["deleted_at"]) continue;
        out.push({
          id: doc.$id,
          name: String(doc["name"] ?? ""),
          timezone: String(doc["timezone"] ?? "America/Sao_Paulo"),
          settings: parseSettings(doc["settings"]),
        });
      }
      if (page.documents.length < 100) break;
      cursor = page.documents[page.documents.length - 1]!.$id;
    }
    return out;
  }

  async createLoginCode(data: { phone_e164: string; code_hash: string; expires_at: string; attempts: number }) {
    return (await this.databases.createDocument(this.databaseId, "login_codes", this.newId(), data)) as unknown as Row;
  }
  async findLoginCodes(phone: string) {
    const res = await this.databases.listDocuments(this.databaseId, "login_codes", [
      Query.equal("phone_e164", [phone]),
      Query.orderDesc("$createdAt"),
      Query.limit(25),
    ]);
    return res.documents as unknown as Row[];
  }
  async updateLoginCode(id: string, data: Record<string, unknown>) {
    return (await this.databases.updateDocument(this.databaseId, "login_codes", id, data)) as unknown as Row;
  }
}
