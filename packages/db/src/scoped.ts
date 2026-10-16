import { ID, Permission, Query, Role, type Databases, type Models } from "node-appwrite";
import { COLLECTIONS } from "@medcuidar/shared";

export class FamilyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FamilyScopeError";
  }
}

type Doc = Models.Document & Record<string, unknown>;

const GLOBAL = new Set(COLLECTIONS.filter((c) => c.global).map((c) => c.id));
const KNOWN = new Set(COLLECTIONS.map((c) => c.id));

/**
 * Acesso a dados preso a UMA família. Toda leitura filtra por `family_id`, toda escrita injeta
 * `family_id` e a permissão de leitura do Team, e documento de outra família é tratado como
 * inexistente. O código da aplicação deve usar só esta classe, nunca `Databases` direto.
 */
export class FamilyScopedDb {
  constructor(
    private readonly databases: Pick<
      Databases,
      "createDocument" | "getDocument" | "listDocuments" | "updateDocument" | "deleteDocument"
    >,
    private readonly databaseId: string,
    readonly familyId: string,
  ) {
    if (!familyId || familyId.length < 3) throw new FamilyScopeError("familyId inválido");
  }

  private check(collection: string) {
    if (!KNOWN.has(collection)) throw new FamilyScopeError(`Coleção desconhecida: ${collection}`);
    if (GLOBAL.has(collection)) {
      throw new FamilyScopeError(`Coleção global "${collection}" não é acessível por escopo de família`);
    }
  }

  private teamRead() {
    return [Permission.read(Role.team(this.familyId))];
  }

  async create(collection: string, data: Record<string, unknown>, id: string = ID.unique()): Promise<Doc> {
    this.check(collection);
    if ("family_id" in data && data["family_id"] !== this.familyId) {
      throw new FamilyScopeError("family_id do dado difere da família do escopo");
    }
    return (await this.databases.createDocument(
      this.databaseId,
      collection,
      id,
      { ...data, family_id: this.familyId },
      this.teamRead(),
    )) as Doc;
  }

  async get(collection: string, id: string): Promise<Doc> {
    this.check(collection);
    const doc = (await this.databases.getDocument(this.databaseId, collection, id)) as Doc;
    if (doc["family_id"] !== this.familyId) {
      throw new FamilyScopeError(`Documento ${collection}/${id} não pertence à família`);
    }
    return doc;
  }

  async list(collection: string, queries: string[] = []): Promise<Models.DocumentList<Doc>> {
    this.check(collection);
    return (await this.databases.listDocuments(this.databaseId, collection, [
      Query.equal("family_id", this.familyId),
      ...queries,
    ])) as Models.DocumentList<Doc>;
  }

  async update(collection: string, id: string, data: Record<string, unknown>): Promise<Doc> {
    this.check(collection);
    if ("family_id" in data) throw new FamilyScopeError("family_id não pode ser alterado");
    await this.get(collection, id); // garante que pertence à família antes de escrever
    return (await this.databases.updateDocument(this.databaseId, collection, id, data)) as Doc;
  }

  async remove(collection: string, id: string): Promise<void> {
    this.check(collection);
    await this.get(collection, id);
    await this.databases.deleteDocument(this.databaseId, collection, id);
  }
}
