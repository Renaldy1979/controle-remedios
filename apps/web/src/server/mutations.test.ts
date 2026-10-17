import { SYSTEM_PROFILES, familySettingsSchema } from "@medcuidar/shared";
import type { AttachDraft } from "@/data/types";
import { ForbiddenError, type Ctx } from "./context";
import * as m from "./mutations";

/** O banco falha se for tocado: a recusa por permissão precisa acontecer ANTES de qualquer acesso a dados. */
const untouchableDb = new Proxy({}, { get: () => () => { throw new Error("o banco não pode ser acessado antes da checagem de permissão"); } }) as Ctx["db"];

const ctxOf = (profile: string): Ctx => {
  const p = SYSTEM_PROFILES.find((x) => x.name === profile)!;
  return { familyId: "fam-t", db: untouchableDb, member: { id: "m-1", name: "Teste", profileName: p.name, permissions: p.permissions }, timezone: "America/Sao_Paulo", settings: familySettingsSchema.parse({}) };
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
