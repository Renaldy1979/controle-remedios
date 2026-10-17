import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import type { AttachDraft } from "@/data/types";
import { ForbiddenError, type Ctx } from "./context";
import * as m from "./mutations";

/** O banco falha se for tocado: a recusa por permissão precisa acontecer ANTES de qualquer acesso a dados. */
const untouchableDb = new Proxy({}, { get: () => () => { throw new Error("o banco não pode ser acessado antes da checagem de permissão"); } }) as Ctx["db"];

const ctxOf = (profile: string): Ctx => {
  const p = SYSTEM_PROFILES.find((x) => x.name === profile)!;
  return { familyId: "fam-t", familyName: "Família", canSwitchFamily: false, userId: "u-1", db: untouchableDb, member: { id: "m-1", name: "Teste", profileName: p.name, permissions: p.permissions }, timezone: "America/Sao_Paulo", settings: familySettingsSchema.parse({}) };
};

const draft: AttachDraft = { patientId: "p1", date: "16/10/2026", doctor: "", specialty: "", medicationIds: ["m1"], validity: "30", notes: "", pages: 1 };

describe("o servidor recusa o que o perfil não pode (não só esconde na tela)", () => {
  it("Confirmador não anexa, exclui nem compartilha receitas", async () => {
    const ctx = ctxOf("Confirmador");
    await expect(m.saveRx(ctx, draft, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.deleteRx(ctx, "rx1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.restoreRx(ctx, "rx1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.markSuperseded(ctx, "rx1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.recordRxView(ctx, "rx1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.shareRx(ctx, "rx1", { memberIds: ["m2"], label: "x" }, "MedCuidar")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Confirmador não mexe em estoque, reposição, remédios, esquemas, pessoas, perfis nem avisos", async () => {
    const ctx = ctxOf("Confirmador");
    await expect(m.registerPurchase(ctx, "med", 5)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.adjustStock(ctx, "med", 5, "")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.previewStockDays(ctx, "med", 5)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.assumeReplenishment(ctx, "med")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.advanceReplenishment(ctx, "med")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.updateMedication(ctx, "med", { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.deleteMedication(ctx, "med")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.saveScheme(ctx, "med", { single: true, firstTime: "08:00", phases: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.inviteMember(ctx, { name: "x", phone: "11912345678", profileName: "Familiar", relation: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.removeMember(ctx, "m2")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.setPermission(ctx, "view", "Familiar", true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.setNotification(ctx, { leadDays: 3 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Cuidadora confirma doses, mas não anexa, compartilha nem exclui receitas", async () => {
    const ctx = ctxOf("Cuidadora");
    await expect(m.saveRx(ctx, draft, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.shareRx(ctx, "rx1", { memberIds: ["m2"], label: "x" }, "WhatsApp")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.deleteRx(ctx, "rx1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.registerPurchase(ctx, "med", 5)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Familiar não gerencia pessoas, perfis nem avisos, e não exclui receitas", async () => {
    const ctx = ctxOf("Familiar");
    await expect(m.inviteMember(ctx, { name: "x", phone: "11912345678", profileName: "Familiar", relation: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.setPermission(ctx, "view", "Cuidadora", false)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.setNotification(ctx, { leadDays: 3 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(m.deleteRx(ctx, "rx1")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("validações antes de tocar no banco", () => {
  it("data de receita no formato dd/mm/aaaa e válida", () => {
    expect(m.parseBrDate("16/10/2026")).toBe("2026-10-16");
    expect(m.parseBrDate("31/02/2026")).toBeNull();
    expect(m.parseBrDate("2026-10-16")).toBeNull();
    expect(m.parseBrDate("1/1/2026")).toBeNull();
  });
});

// ───────── sessões do Appwrite são derrubadas ao remover pessoa ou trocar telefone ─────────
import { beforeEach, vi } from "vitest";
import * as session from "./session";

vi.mock("./session", () => ({ revokeUserSessions: vi.fn(async () => undefined) }));

type Doc = Record<string, unknown> & { $id: string };
function fakeDb(seed: Record<string, Doc[]>) {
  const data: Record<string, Doc[]> = JSON.parse(JSON.stringify(seed));
  const find = (c: string, id: string) => {
    const d = data[c]?.find((x) => x.$id === id);
    if (!d) throw Object.assign(new Error("not found"), { code: 404 });
    return d;
  };
  return {
    data,
    get: async (c: string, id: string) => find(c, id),
    list: async (c: string, queries: string[] = []) => {
      // entende só `equal`, que é o que as mutações usam para filtrar
      const filters = queries.map((q) => JSON.parse(q) as { method: string; attribute?: string; values?: unknown[] }).filter((q) => q.method === "equal" && q.attribute);
      const documents = (data[c] ?? []).filter((d) => filters.every((f) => (f.values ?? []).includes(d[f.attribute!])));
      return { documents, total: documents.length };
    },
    create: async (c: string, d: Record<string, unknown>) => {
      const doc = { $id: `n${(data[c] ?? []).length + 1}`, ...d };
      (data[c] ??= []).push(doc);
      return doc;
    },
    update: async (c: string, id: string, d: Record<string, unknown>) => Object.assign(find(c, id), d),
    remove: async (c: string, id: string) => {
      data[c] = (data[c] ?? []).filter((x) => x.$id !== id);
    },
  };
}

const world = () =>
  fakeDb({
    profiles: [
      { $id: "prof-adm", name: "Administrador", permissions: "{}" },
      { $id: "prof-fam", name: "Familiar", permissions: "{}" },
    ],
    members: [
      { $id: "m-ana", name: "Ana", phone_e164: "+5511900000001", profile_id: "prof-adm", active: true, user_id: "u-ana" },
      { $id: "m-bia", name: "Beatriz", phone_e164: "+5511900000002", profile_id: "prof-fam", active: true, user_id: "u-bia" },
    ],
    care_assignments: [],
    audit_log: [],
  });

const adminCtx = (db: ReturnType<typeof fakeDb>): Ctx => ({ ...ctxOf("Administrador"), member: { id: "m-ana", name: "Ana", profileName: "Administrador", permissions: {} }, db: db as unknown as Ctx["db"] });

describe("revogar sessões do Appwrite", () => {
  const revoke = vi.mocked(session.revokeUserSessions);
  beforeEach(() => revoke.mockClear());

  it("remover uma pessoa derruba as sessões dela e a desativa", async () => {
    const db = world();
    await m.removeMember(adminCtx(db), "m-bia");
    expect(revoke).toHaveBeenCalledWith("u-bia");
    expect(db.data["members"]!.find((x) => x.$id === "m-bia")!["active"]).toBe(false);
  });

  it("não remove a si mesmo nem o último Administrador", async () => {
    const db = world();
    await expect(m.removeMember(adminCtx(db), "m-ana")).rejects.toThrow(/si mesmo/);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("trocar o telefone derruba as sessões antigas e solta o vínculo com o usuário", async () => {
    const db = world();
    await m.updateMember(adminCtx(db), "m-bia", { name: "Beatriz", phone: "11 91234-5678", profileName: "Familiar", relation: "filha" });
    expect(revoke).toHaveBeenCalledWith("u-bia");
    const bia = db.data["members"]!.find((x) => x.$id === "m-bia")!;
    expect(bia["phone_e164"]).toBe("+5511912345678");
    expect(bia["user_id"]).toBeNull();
  });

  it("editar sem trocar o telefone não derruba ninguém", async () => {
    const db = world();
    await m.updateMember(adminCtx(db), "m-bia", { name: "Bia", phone: "(11) 90000-0002", profileName: "Familiar", relation: "filha" });
    expect(revoke).not.toHaveBeenCalled();
  });
});
