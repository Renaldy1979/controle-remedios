import { describe, expect, it, vi } from "vitest";
import { FamilyScopedDb, FamilyScopeError } from "./scoped";

function fakeDb(store: Record<string, Record<string, unknown>> = {}) {
  return {
    createDocument: vi.fn(async (_d: string, c: string, id: string, data: Record<string, unknown>, _perms?: string[]) => {
      const doc = { $id: id, ...data };
      store[`${c}/${id}`] = doc;
      return doc;
    }),
    getDocument: vi.fn(async (_d: string, c: string, id: string) => {
      const d = store[`${c}/${id}`];
      if (!d) throw Object.assign(new Error("not found"), { code: 404 });
      return d;
    }),
    listDocuments: vi.fn(async (_d: string, _c: string, queries: string[]) => ({ total: 0, documents: [], queries })),
    updateDocument: vi.fn(async (_d: string, c: string, id: string, data: Record<string, unknown>) => {
      store[`${c}/${id}`] = { ...store[`${c}/${id}`], ...data };
      return store[`${c}/${id}`];
    }),
    deleteDocument: vi.fn(async (_d: string, c: string, id: string) => {
      delete store[`${c}/${id}`];
    }),
  };
}

describe("FamilyScopedDb", () => {
  it("injeta family_id e permissão do Team na criação", async () => {
    const db = fakeDb();
    const scoped = new FamilyScopedDb(db as never, "dbid", "famA");
    await scoped.create("patients", { name: "Adelino", can_use_phone: true, active: true }, "p1");
    const args = db.createDocument.mock.calls[0]!;
    expect((args[3] as Record<string, unknown>)["family_id"]).toBe("famA");
    expect(args[4]).toEqual(['read("team:famA")']);
  });

  it("recusa criar com family_id de outra família", async () => {
    const scoped = new FamilyScopedDb(fakeDb() as never, "dbid", "famA");
    await expect(scoped.create("patients", { name: "x", family_id: "famB" })).rejects.toBeInstanceOf(FamilyScopeError);
  });

  it("lista sempre com filtro por family_id", async () => {
    const db = fakeDb();
    const scoped = new FamilyScopedDb(db as never, "dbid", "famA");
    await scoped.list("patients");
    expect(db.listDocuments.mock.calls[0]![2]![0]).toContain("family_id");
    expect(db.listDocuments.mock.calls[0]![2]![0]).toContain("famA");
  });

  it("documento de outra família é recusado em get, update e remove", async () => {
    const store = { "patients/p9": { $id: "p9", family_id: "famB", name: "Alheio" } };
    const db = fakeDb(store);
    const scoped = new FamilyScopedDb(db as never, "dbid", "famA");
    await expect(scoped.get("patients", "p9")).rejects.toBeInstanceOf(FamilyScopeError);
    await expect(scoped.update("patients", "p9", { name: "x" })).rejects.toBeInstanceOf(FamilyScopeError);
    await expect(scoped.remove("patients", "p9")).rejects.toBeInstanceOf(FamilyScopeError);
    expect(db.updateDocument).not.toHaveBeenCalled();
    expect(db.deleteDocument).not.toHaveBeenCalled();
  });

  it("não deixa alterar family_id", async () => {
    const store = { "patients/p1": { $id: "p1", family_id: "famA" } };
    const scoped = new FamilyScopedDb(fakeDb(store) as never, "dbid", "famA");
    await expect(scoped.update("patients", "p1", { family_id: "famB" })).rejects.toBeInstanceOf(FamilyScopeError);
  });

  it("recusa coleções globais e desconhecidas", async () => {
    const scoped = new FamilyScopedDb(fakeDb() as never, "dbid", "famA");
    await expect(scoped.list("families")).rejects.toBeInstanceOf(FamilyScopeError);
    await expect(scoped.list("login_codes")).rejects.toBeInstanceOf(FamilyScopeError);
    await expect(scoped.list("nao_existe")).rejects.toBeInstanceOf(FamilyScopeError);
  });
});
