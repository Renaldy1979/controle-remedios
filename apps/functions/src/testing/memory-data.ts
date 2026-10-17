import type { Cond, FamilyData, FamilyInfo, FindOptions, GlobalData, Row, Where } from "../ports";
import { parseSettings } from "../rows";

/** Índices únicos do modelo (docs/02) que os fakes precisam respeitar. */
const UNIQUE: Record<string, string[]> = {
  notifications_outbox: ["dedupe_key"],
  whatsapp_messages: ["provider_message_id"],
  dose_events: ["source_message_id"],
  stock_movements: ["dose_event_id"],
  members: [],
};

function conflict(): Error {
  return Object.assign(new Error("unique index violation"), { code: 409 });
}
function notFound(): Error {
  return Object.assign(new Error("not found"), { code: 404 });
}

function matches(value: unknown, cond: Cond): boolean {
  if (typeof cond !== "object") return value === cond;
  if ("in" in cond) return cond.in.includes(value as never);
  const v = value as string | number;
  if (value === null || value === undefined) return false;
  if (cond.ne !== undefined && value === cond.ne) return false;
  if (cond.lt !== undefined && !(v < cond.lt)) return false;
  if (cond.lte !== undefined && !(v <= cond.lte)) return false;
  if (cond.gt !== undefined && !(v > cond.gt)) return false;
  if (cond.gte !== undefined && !(v >= cond.gte)) return false;
  return true;
}

/** Banco em memória compartilhado entre famílias, com isolamento por `family_id` como o FamilyScopedDb. */
export class MemoryStore {
  readonly tables = new Map<string, Map<string, Row>>();
  families: FamilyInfo[] = [];
  private seq = 0;
  /** Relógio para $createdAt (injetável em testes). */
  nowIso: () => string = () => new Date().toISOString();

  table(name: string): Map<string, Row> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  nextId(): string {
    this.seq += 1;
    return `id${String(this.seq).padStart(5, "0")}`;
  }

  insert(collection: string, data: Record<string, unknown>, id?: string): Row {
    const t = this.table(collection);
    const docId = id ?? this.nextId();
    if (t.has(docId)) throw conflict();
    for (const field of UNIQUE[collection] ?? []) {
      const v = data[field];
      if (v !== undefined && v !== null && [...t.values()].some((r) => r[field] === v)) throw conflict();
    }
    const now = this.nowIso();
    const row: Row = { $id: docId, $createdAt: now, $updatedAt: now, ...data };
    t.set(docId, row);
    return row;
  }

  /** Atalho para montar fixtures. */
  seed(collection: string, familyId: string, id: string, data: Record<string, unknown>): Row {
    return this.insert(collection, { family_id: familyId, ...data }, id);
  }

  all(collection: string): Row[] {
    return [...this.table(collection).values()];
  }
}

export class MemoryFamilyData implements FamilyData {
  constructor(
    private readonly store: MemoryStore,
    readonly familyId: string,
  ) {}

  async create(collection: string, data: Record<string, unknown>, id?: string) {
    if (data["family_id"] !== undefined && data["family_id"] !== this.familyId) throw new Error("family_id difere do escopo");
    return { ...this.store.insert(collection, { ...data, family_id: this.familyId }, id) };
  }
  async get(collection: string, id: string) {
    const row = await this.getOrNull(collection, id);
    if (!row) throw notFound();
    return row;
  }
  async getOrNull(collection: string, id: string) {
    const row = this.store.table(collection).get(id);
    if (!row) return null;
    if (row["family_id"] !== this.familyId) throw new Error("Documento não pertence à família");
    return { ...row };
  }
  async find(collection: string, where: Where = {}, options: FindOptions = {}) {
    let rows = this.store
      .all(collection)
      .filter((r) => r["family_id"] === this.familyId)
      .filter((r) => Object.entries(where).every(([k, c]) => matches(r[k], c)));
    if (options.orderBy) {
      const key = options.orderBy;
      const dir = options.order === "desc" ? -1 : 1;
      if (dir === -1) rows = rows.reverse(); // empate: o mais novo (inserido depois) primeiro, como no banco real
      rows = rows.sort((a, b) => (String(a[key] ?? "") < String(b[key] ?? "") ? -dir : String(a[key] ?? "") > String(b[key] ?? "") ? dir : 0));
    }
    return rows.slice(0, options.limit ?? 100).map((r) => ({ ...r }));
  }
  async update(collection: string, id: string, data: Record<string, unknown>) {
    if ("family_id" in data) throw new Error("family_id não pode ser alterado");
    const row = await this.get(collection, id);
    const next = { ...row, ...data, $updatedAt: this.store.nowIso() };
    this.store.table(collection).set(id, next);
    return { ...next };
  }
}

export class MemoryGlobalData implements GlobalData {
  constructor(private readonly store: MemoryStore) {}

  async listFamilies() {
    return this.store.families;
  }
  async createLoginCode(data: { phone_e164: string; code_hash: string; expires_at: string; attempts: number }) {
    return { ...this.store.insert("login_codes", data) };
  }
  async findLoginCodes(phone: string) {
    return this.store
      .all("login_codes")
      .filter((r) => r["phone_e164"] === phone)
      .sort((a, b) => String(b.$createdAt).localeCompare(String(a.$createdAt)))
      .map((r) => ({ ...r }));
  }
  async updateLoginCode(id: string, data: Record<string, unknown>) {
    const t = this.store.table("login_codes");
    const row = t.get(id);
    if (!row) throw notFound();
    const next = { ...row, ...data };
    t.set(id, next);
    return { ...next };
  }
}

export function familyInfo(id: string, settings: Record<string, unknown> = {}, name = "Família Teste"): FamilyInfo {
  return { id, name, timezone: "America/Sao_Paulo", settings: parseSettings(settings) };
}
