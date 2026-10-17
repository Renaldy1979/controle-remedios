import { describe, expect, it } from "vitest";
import { AppwriteAuth } from "./domain/appwrite-adapters";
import { buildServices } from "./services";
import { buildRealWorld } from "./testing/real-world";
import { FAMILY_ID, PHONES } from "./testing/world";

function setup(opts: Parameters<typeof buildRealWorld>[0] = {}) {
  const w = buildRealWorld(opts);
  const svc = buildServices({ global: w.global, dataFor: w.dataFor, domain: w.realDomain, channel: w.channel, login: w.loginDeps, now: () => w.clock.current });
  return { w, svc };
}
const base = { familyId: FAMILY_ID, memberId: "mem-ana" };

describe("serviços do painel: dose, desfazer, estoque", () => {
  it("confirmar → desfazer → confirmar: o saldo acompanha o livro-razão", async () => {
    const { w, svc } = setup({ zypredBalance: 60 });
    w.advance(1);
    const confirmed = await svc.doses.confirm({ ...base, doseEventId: "dose-zyp", channel: "panel" });
    expect(confirmed.result.outcome).toBe("confirmed");
    expect(await svc.stock.balance(FAMILY_ID, "stk-zypred")).toBe(59);

    const again = await svc.doses.confirm({ ...base, doseEventId: "dose-zyp", channel: "panel" });
    expect(again.result.outcome).toBe("already_taken");
    expect(await svc.stock.balance(FAMILY_ID, "stk-zypred")).toBe(59);

    const undone = await svc.doses.undo({ familyId: FAMILY_ID, doseEventId: "dose-zyp", memberId: "mem-ana" });
    expect(undone).toMatchObject({ result: "undone", stockRestored: true });
    expect(await svc.stock.balance(FAMILY_ID, "stk-zypred")).toBe(60);
    expect(Number((await w.data.get("stock_items", "stk-zypred"))["cached_balance"])).toBe(60);
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("pending");
    expect((await svc.doses.undo({ familyId: FAMILY_ID, doseEventId: "dose-zyp", memberId: "mem-ana" })).result).toBe("not_taken");

    await svc.doses.confirm({ ...base, doseEventId: "dose-zyp", channel: "panel" });
    expect(await svc.stock.balance(FAMILY_ID, "stk-zypred")).toBe(59);
    // O movimento original nunca é duplicado nem apagado.
    expect(w.movements()).toHaveLength(1);
  });

  it("confirmar pelo painel que leva o estoque ao limite já devolve o aviso de reposição", async () => {
    const { w, svc } = setup({ zypredBalance: 56 });
    w.advance(1);
    const { lowStock } = await svc.doses.confirm({ ...base, doseEventId: "dose-zyp", channel: "panel" });
    expect(lowStock).toHaveLength(1);
    expect(lowStock[0]).toMatchObject({ medicationName: "Zypred", level: "attention", daysLeft: 14 });
  });

  it("ajuste manual vira movimento com a diferença; igual ao saldo não grava nada; compra soma", async () => {
    const { w, svc } = setup({ zypredBalance: 60 });
    const adj = await svc.stock.adjust({ ...base, stockItemId: "stk-zypred", newBalance: 40, note: "frasco derramou" });
    expect(adj.movement).toMatchObject({ type: "adjustment", quantity: -20 });
    expect(adj.balance).toBe(40);
    expect((await svc.stock.adjust({ ...base, stockItemId: "stk-zypred", newBalance: 40 })).movement).toBeNull();
    expect((await svc.stock.registerPurchase({ ...base, stockItemId: "stk-zypred", quantity: 100 })).balance).toBe(140);
    await expect(svc.stock.registerPurchase({ ...base, stockItemId: "stk-zypred", quantity: 0 })).rejects.toThrow();
    expect(w.store.all("audit_log").some((a) => a["action"] === "stock.adjust")).toBe(true);
  });
});

describe("serviços do painel: reposição e receitas", () => {
  async function openRepl(svc: ReturnType<typeof setup>["svc"]) {
    const [alert] = await svc.domain.checkLowStock({ familyId: FAMILY_ID, patientId: "pat-adelino" });
    return alert!.replenishmentId;
  }

  it("assumir, conferir dono, concluir etapas e fechar somando a compra ao estoque", async () => {
    const { svc } = setup({ zypredBalance: 20 });
    const id = await openRepl(svc);
    expect((await svc.replenishment.claim({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-ana" })).ok).toBe(true);
    expect(await svc.replenishment.claim({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-rosa" })).toEqual({ ok: false, reason: "already_claimed" });
    expect((await svc.replenishment.claim({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-rosa", takeOver: true })).ok).toBe(true);
    expect(await svc.replenishment.advance({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-ana", action: "complete" })).toEqual({ ok: false, reason: "not_owner" });
    expect(await svc.replenishment.advance({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-rosa", action: "complete" })).toEqual({ ok: false, reason: "missing_purchase_quantity" });
    expect((await svc.replenishment.advance({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-rosa", action: "complete", purchaseQuantity: 100 })).ok).toBe(true);
    const closing = await svc.replenishment.advance({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-rosa", action: "complete" });
    expect(closing).toMatchObject({ ok: true, replenishment: { status: "done" } });
    expect(await svc.stock.balance(FAMILY_ID, "stk-zypred")).toBe(120); // 20 + compra de 100
    expect(await svc.replenishment.advance({ familyId: FAMILY_ID, replenishmentId: id, memberId: "mem-rosa", action: "cancel" })).toEqual({ ok: false, reason: "closed" });
    expect(await svc.replenishment.claim({ familyId: FAMILY_ID, replenishmentId: "x", memberId: "mem-ana" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("salvar receita nova substitui a vencida do mesmo remédio e avança a reposição", async () => {
    const { w, svc } = setup({ zypredBalance: 20 });
    // receita vigente do seed fica; cria uma vencida e uma reposição esperando receita
    w.store.table("prescriptions").delete("rx-zypred");
    w.store.table("prescription_items").delete("rxi-zypred");
    w.store.seed("prescriptions", FAMILY_ID, "rx-velha", { patient_id: "pat-adelino", issued_on: "2026-01-01", valid_until: "2026-04-01", status: "valid" });
    w.store.seed("prescription_items", FAMILY_ID, "rxi-velha", { prescription_id: "rx-velha", medication_id: "med-zypred" });
    const replId = await openRepl(svc);
    expect((await w.data.get("replenishments", replId))["status"]).toBe("needs_prescription");

    const res = await svc.prescriptions.save({
      familyId: FAMILY_ID, memberId: "mem-ana", patientId: "pat-adelino", issuedOn: "2026-10-15", validUntil: "2027-04-15", doctorName: "Dra. Helena Prado",
      medicationIds: ["med-zypred"], files: [{ storageFileId: "file-1", page: 1, mime: "image/jpeg", size: 1234 }],
    });
    expect(res.superseded).toEqual(["rx-velha"]);
    expect(res.replenishmentsAdvanced).toEqual([replId]);
    expect(await w.data.get("prescriptions", "rx-velha")).toMatchObject({ status: "superseded", superseded_by_id: res.prescriptionId });
    expect((await w.data.get("replenishments", replId))["status"]).toBe("prescription_received");
    await expect(svc.prescriptions.save({ familyId: FAMILY_ID, memberId: "mem-ana", patientId: "pat-adelino", issuedOn: "2026-10-15", medicationIds: [], files: [] })).rejects.toThrow();
  });

  it("compartilhar no WhatsApp: registra, audita e entrega com URL assinada", async () => {
    const { w, svc } = setup();
    w.store.seed("prescription_files", FAMILY_ID, "rxf-1", { prescription_id: "rx-zypred", storage_file_id: "file-9", page: 1, mime: "image/jpeg", size: 10 });
    expect(await svc.prescriptions.share({ familyId: FAMILY_ID, prescriptionId: "rx-zypred", memberId: "mem-ana", targetMemberId: "mem-rosa" })).toEqual({ shared: true });
    await w.flushOutbox();
    const sent = w.channel.sent.find((m) => m.to === PHONES.rosa && m.media)!;
    expect(sent.media!.url).toContain("file-9");
    expect(w.store.all("prescription_shares")).toHaveLength(1);
    await svc.prescriptions.recordView({ familyId: FAMILY_ID, prescriptionId: "rx-zypred", memberId: "mem-ana" });
    expect(w.store.all("prescription_views")).toHaveLength(1);
    // receita sem arquivo não é compartilhada
    w.store.seed("prescriptions", FAMILY_ID, "rx-sem-foto", { patient_id: "pat-maria", status: "valid", issued_on: "2026-10-01" });
    expect(await svc.prescriptions.share({ familyId: FAMILY_ID, prescriptionId: "rx-sem-foto", memberId: "mem-ana", targetMemberId: "mem-rosa" })).toEqual({ shared: false });
  });
});

describe("login por código com sessão real do Appwrite (fake de Users)", () => {
  function fakeUsers() {
    const users = new Map<string, { $id: string; phone: string }>();
    const calls = { create: 0, token: 0 };
    return {
      users, calls,
      api: {
        async create(p: { userId: string; phone?: string }) {
          calls.create += 1;
          if ([...users.values()].some((u) => u.phone === p.phone)) throw Object.assign(new Error("exists"), { code: 409 });
          const u = { $id: p.userId, phone: p.phone! };
          users.set(u.$id, u);
          return u;
        },
        async list() {
          return { users: [...users.values()] };
        },
        async createToken(p: { userId: string }) {
          calls.token += 1;
          return { secret: `segredo-${p.userId}`, userId: p.userId, expire: "2026-10-15T17:15:00.000Z" };
        },
      },
    };
  }

  it("primeira entrada cria o usuário e vincula members.user_id; a segunda reutiliza", async () => {
    const { w, svc } = setup();
    const fu = fakeUsers();
    w.loginDeps.auth = new AppwriteAuth(fu.api as never, { global: w.global, dataFor: w.dataFor });

    await svc.login.requestCode(PHONES.ana);
    const code = /\*(\d{6})\*/.exec(w.channel.sent.find((m) => m.text.includes("Código de acesso"))!.text)![1]!;
    const first = await svc.login.verifyCode(PHONES.ana, code);
    expect(first).toMatchObject({ ok: true, userId: expect.any(String), token: expect.stringContaining("segredo-") });
    const userId = (first as { userId: string }).userId;
    expect((await w.data.get("members", "mem-ana"))["user_id"]).toBe(userId);
    expect(fu.calls.create).toBe(1);

    w.advance(2);
    await svc.login.requestCode(PHONES.ana);
    const code2 = /\*(\d{6})\*/.exec(w.channel.sent.filter((m) => m.text.includes("Código de acesso")).at(-1)!.text)![1]!;
    expect(await svc.login.verifyCode(PHONES.ana, code2)).toMatchObject({ ok: true, userId });
    expect(fu.calls.create).toBe(1); // reutilizou
  });

  it("usuário já existente com o mesmo telefone (409) é reaproveitado", async () => {
    const { w } = setup();
    const fu = fakeUsers();
    fu.users.set("u-antigo", { $id: "u-antigo", phone: PHONES.rosa });
    const auth = new AppwriteAuth(fu.api as never, { global: w.global, dataFor: w.dataFor });
    expect(await auth.createSessionFor(PHONES.rosa)).toMatchObject({ userId: "u-antigo" });
    expect((await w.data.get("members", "mem-rosa"))["user_id"]).toBe("u-antigo");
    expect(await auth.createSessionFor(PHONES.stranger)).toBeNull();
  });
});
