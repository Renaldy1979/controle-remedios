// @vitest-environment node
/**
 * Integração do Lote 2 contra o Postgres local (pnpm db:up): doses geradas, confirmar/desfazer idempotentes, estoque como
 * livro-razão, aviso de estoque baixo (uma vez por ciclo, para as pessoas certas), permissões no servidor e RLS entre
 * duas famílias nas tabelas do lote. Papel da APLICAÇÃO (sem BYPASSRLS). Sem o banco no ar, a suíte é PULADA.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import { localParts } from "@medcuidar/domain";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, prepararBanco, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import type { Ctx } from "./access";
import { ForbiddenError, UserError } from "./errors";
import { createFamilyWithAdmin } from "./families";
import { confirmDose, ensureDosesForDay, listDoseHistory, refreshDoseStatuses, snoozeDose, undoDose, type DoseActor } from "./doses";
import * as meds from "./medications";
import { listNotices, markNoticesRead } from "./notices";
import * as patients from "./patients";
import { prepareDay } from "./prepare";
import { buildSnapshot } from "./snapshot";
import { adjustStock, evaluateLowStockForFamily, previewStockDays, registerPurchase, saveNoticeSettings } from "./stock";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes de integração do Lote 2 PULADOS. Rode `pnpm db:up`.");

const DAY = "2026-10-19";
/** 12:00 de São Paulo no dia de teste: depois da dose das 06:00, antes das de 14:00 e 22:00. */
const NOON = new Date("2026-10-19T15:00:00Z");
const TZ = "America/Sao_Paulo";
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;

interface Fam {
  familyId: string;
  admin: DoseActor;
  patientId: string;
  /** remédio de 8 em 8 h a partir das 06:00 (3 doses por dia), 1 comprimido */
  medId: string;
  /** os ids das 3 doses do dia, em ordem */
  doses: string[];
}

const settings = familySettingsSchema.parse({});
const actorOf = (familyId: string, memberId: string, profileName: string, name = profileName, permissions?: PermissionMap): DoseActor => ({
  familyId, memberId, timezone: TZ, settings, member: { id: memberId, name, profileName, permissions: permissions ?? permsOf(profileName) },
});
const ctxOf = (a: DoseActor): Ctx => ({
  familyId: a.familyId, familyName: "Família Teste", timezone: TZ, settings: a.settings as Ctx["settings"],
  account: { id: "x", email: "x@exemplo.test", name: a.member.name, emailVerified: true }, memberId: a.memberId, profileId: "p", member: a.member,
});

async function membro(familyId: string, profileName: string, nome: string, extra: Partial<typeof s.members.$inferInsert> = {}): Promise<DoseActor> {
  const id = await withFamilia(familyId, async (tx) => {
    const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, profileName));
    const active = extra.accessState === undefined || extra.accessState === "active";
    const [m] = await tx
      .insert(s.members)
      .values({
        familyId, profileId: p!.id, name: nome, email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: "active",
        appwriteUserId: active ? `zz-test-${randomUUID()}` : null, emailConfirmedAt: active ? new Date() : null, ...extra,
      })
      .returning({ id: s.members.id });
    return m!.id;
  });
  return actorOf(familyId, id, profileName, nome);
}

describe.skipIf(!up)("Lote 2 — doses e estoque no Postgres", () => {
  let admin: Admin;
  const criadas: string[] = [];

  async function novaFamilia(nome: string): Promise<Fam> {
    const r = await createFamilyWithAdmin({
      appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}`,
    });
    criadas.push(r.familyId);
    const a = actorOf(r.familyId, r.memberId, "Administrador", `Admin ${nome}`);
    const patientId = await patients.savePatient(a, { name: `Paciente ${nome}`, birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medId = await meds.createMedication(a, { patientId, name: `Remédio ${nome}`, alternatives: [], route: "tablet", controlUnit: "unit" });
    await meds.saveScheme(a, medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
    await ensureDosesForDay(r.familyId, DAY);
    const doses = await withFamilia(r.familyId, (tx) => tx.select({ id: s.doseEvents.id }).from(s.doseEvents).orderBy(s.doseEvents.scheduledAt));
    return { familyId: r.familyId, admin: a, patientId, medId, doses: doses.map((d) => d.id) };
  }

  const balance = async (f: Fam) => {
    const [r] = await admin`select coalesce(sum(m.quantity), 0)::float8 as total from stock_movements m join stock_items i on i.id = m.stock_item_id where i.family_id = ${f.familyId} and i.medication_id = ${f.medId}`;
    return r!["total"] as number;
  };
  const doseMovements = async (doseId: string) => (await admin`select * from stock_movements where dose_event_id = ${doseId}`).length;
  const noticesOf = async (f: Fam) => (await admin`select member_id, dedupe_key from notifications where family_id = ${f.familyId}`) as unknown as Array<{ member_id: string; dedupe_key: string }>;

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
  });
  afterAll(async () => {
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  describe("doses geradas das fases", () => {
    it("gera 3 doses para o dia (06:00, 14:00 e 22:00 locais) e repetir não duplica", async () => {
      const f = await novaFamilia("Gera");
      expect(f.doses).toHaveLength(3);
      const rows = await admin`select scheduled_at, status, amount from dose_events where family_id = ${f.familyId} order by scheduled_at`;
      expect(rows.map((r) => (r["scheduled_at"] as Date).toISOString())).toEqual(["2026-10-19T09:00:00.000Z", "2026-10-19T17:00:00.000Z", "2026-10-20T01:00:00.000Z"]);
      expect(new Set(rows.map((r) => r["status"]))).toEqual(new Set(["pending"]));
      expect((await ensureDosesForDay(f.familyId, DAY)).created).toBe(0);
      const [c] = await admin`select count(*)::int as n from dose_events where family_id = ${f.familyId}`;
      expect(c!["n"]).toBe(3);
    });

    it("duas gerações ao mesmo tempo não duplicam (índice único)", async () => {
      const f = await novaFamilia("Gera2");
      await admin`delete from dose_events where family_id = ${f.familyId}`;
      await Promise.all([ensureDosesForDay(f.familyId, DAY), ensureDosesForDay(f.familyId, DAY), ensureDosesForDay(f.familyId, DAY)]);
      const [c] = await admin`select count(*)::int as n from dose_events where family_id = ${f.familyId}`;
      expect(c!["n"]).toBe(3);
    });

    it("respeita as fases: 3 em 3 h por 2 dias, depois 6 em 6 h", async () => {
      const f = await novaFamilia("Fases");
      await meds.saveScheme(f.admin, f.medId, { startDate: DAY, firstTime: "00:00", phases: [{ everyHours: 3, fromDay: 1, toDay: 2, perDose: 1 }, { everyHours: 6, fromDay: 3, toDay: null, perDose: 2 }] });
      await withFamilia(f.familyId, (tx) => tx.delete(s.doseEvents));
      expect((await ensureDosesForDay(f.familyId, DAY)).created).toBe(8);
      expect((await ensureDosesForDay(f.familyId, "2026-10-20")).created).toBe(8);
      const d3 = await ensureDosesForDay(f.familyId, "2026-10-21");
      expect(d3.created).toBe(4);
      const [r] = await admin`select distinct amount from dose_events where family_id = ${f.familyId} and scheduled_at >= '2026-10-21T03:00:00Z'`;
      expect(r!["amount"]).toBe(2);
    });

    it("remédio ou paciente excluído não gera dose; tratamento pausado também não", async () => {
      const f = await novaFamilia("Excl");
      await meds.deleteMedication(f.admin, f.medId);
      expect((await ensureDosesForDay(f.familyId, "2026-10-22")).created).toBe(0);
      await meds.restoreMedication(f.admin, f.medId);
      await admin`update treatments set status = 'paused' where family_id = ${f.familyId}`;
      expect((await ensureDosesForDay(f.familyId, "2026-10-23")).created).toBe(0);
    });

    it("remédio recém-cadastrado: montar o esquema real não deixa sobrar a dose do esquema padrão das 08:00", async () => {
      const f = await novaFamilia("Padrao");
      const today = localParts(new Date(), TZ).date;
      const id = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Novo", alternatives: [], route: "tablet", controlUnit: "unit" });
      await ensureDosesForDay(f.familyId, today); // esquema padrão: 1 dose às 08:00
      const count = async () => ((await admin`select count(*)::int as n from dose_events where medication_id = ${id}`)[0]!["n"] as number);
      expect(await count()).toBe(1);
      await meds.saveScheme(f.admin, id, { startDate: today, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
      await ensureDosesForDay(f.familyId, today);
      expect(await count()).toBe(3);
      const times = await admin`select scheduled_at from dose_events where medication_id = ${id} order by scheduled_at`;
      expect(times.map((r) => localParts(r["scheduled_at"] as Date, TZ).minutes)).toEqual([360, 840, 1320]);
    });

    it("trocar o esquema refaz só as doses futuras ainda não tocadas", async () => {
      const f = await novaFamilia("Troca");
      // as doses de teste são de 2026-10-19; "futuras" = depois de agora (real). Marca uma como tomada e reconfere que ela permanece.
      await confirmDose(f.admin, f.doses[0]!, NOON);
      await meds.saveScheme(f.admin, f.medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 12, fromDay: 1, toDay: null, perDose: 1 }] });
      const rows = await admin`select id, status from dose_events where family_id = ${f.familyId} and id = ${f.doses[0]!}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!["status"]).toBe("taken");
    });
  });

  describe("confirmar e desfazer (estoque como livro-razão)", () => {
    it("confirmar baixa o estoque; repetir a confirmação não desconta de novo (idempotente)", async () => {
      const f = await novaFamilia("Conf");
      await registerPurchase(f.admin, f.medId, 10, undefined, NOON);
      expect(await balance(f)).toBe(10);
      const r1 = await confirmDose(f.admin, f.doses[0]!, NOON);
      const r2 = await confirmDose(f.admin, f.doses[0]!, NOON);
      expect(r1).toMatchObject({ stockDeducted: true, duplicate: false });
      expect(r2).toMatchObject({ stockDeducted: false, duplicate: true });
      expect(await balance(f)).toBe(9);
      expect(await doseMovements(f.doses[0]!)).toBe(1);
      const [d] = await admin`select status, confirmed_by_member_id, channel from dose_events where id = ${f.doses[0]!}`;
      expect(d).toMatchObject({ status: "taken", confirmed_by_member_id: f.admin.memberId, channel: "panel" });
    });

    it("duas confirmações simultâneas da mesma dose descontam uma vez só", async () => {
      const f = await novaFamilia("Conc");
      await registerPurchase(f.admin, f.medId, 10, undefined, NOON);
      const other = await membro(f.familyId, "Familiar", "Outra pessoa");
      await Promise.all([confirmDose(f.admin, f.doses[1]!, NOON), confirmDose(other, f.doses[1]!, NOON), confirmDose(f.admin, f.doses[1]!, NOON)]);
      expect(await balance(f)).toBe(9);
      expect(await doseMovements(f.doses[1]!)).toBe(1);
    });

    it("a baixa é um movimento por dose: 3 doses = 3 movimentos `dose`", async () => {
      const f = await novaFamilia("Baixa");
      await registerPurchase(f.admin, f.medId, 10, undefined, NOON);
      for (const d of f.doses) await confirmDose(f.admin, d, NOON);
      const [m] = await admin`select count(*)::int as n from stock_movements where family_id = ${f.familyId} and type = 'dose'`;
      expect(m!["n"]).toBe(3);
      expect(await balance(f)).toBe(7);
      const [item] = await admin`select cached_balance from stock_items where family_id = ${f.familyId}`;
      expect(item!["cached_balance"]).toBe(7); // o cache acompanha o livro-razão
    });

    it("desfazer devolve o estoque, é idempotente e permite confirmar de novo (baixa de novo)", async () => {
      const f = await novaFamilia("Undo");
      await registerPurchase(f.admin, f.medId, 10, undefined, NOON);
      await confirmDose(f.admin, f.doses[0]!, NOON);
      expect(await balance(f)).toBe(9);
      const u = await undoDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 5_000));
      expect(u.stockRestored).toBe(true);
      expect(await balance(f)).toBe(10);
      const again = await undoDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 6_000)); // dois cliques
      expect(again.stockRestored).toBe(false);
      expect(await balance(f)).toBe(10);
      const [d] = await admin`select status, confirmed_by_member_id, confirmed_at from dose_events where id = ${f.doses[0]!}`;
      expect(d!["confirmed_by_member_id"]).toBeNull();
      expect(d!["confirmed_at"]).toBeNull();
      await confirmDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 20_000));
      expect(await balance(f)).toBe(9); // baixou de novo uma só vez
      expect(await doseMovements(f.doses[0]!)).toBe(1); // o movimento original continua único
    });

    it("só quem deu o check desfaz, e só dentro da janela", async () => {
      const f = await novaFamilia("Janela");
      const outro = await membro(f.familyId, "Familiar", "Outro");
      await registerPurchase(f.admin, f.medId, 10, undefined, NOON);
      await confirmDose(f.admin, f.doses[0]!, NOON);
      await expect(undoDose(outro, f.doses[0]!, new Date(NOON.getTime() + 2_000))).rejects.toThrow(/Só quem deu o check/);
      await expect(undoDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 60_000))).rejects.toThrow(/prazo/);
      expect(await balance(f)).toBe(9);
    });

    it("registrar que tomou depois (dose esquecida) baixa o estoque e guarda quem e quando", async () => {
      const f = await novaFamilia("Depois");
      await registerPurchase(f.admin, f.medId, 10, undefined, NOON);
      const late = new Date("2026-10-19T14:00:00Z"); // 11:00 local: a das 06:00 já está esquecida
      await refreshDoseStatuses(f.familyId, settings, late);
      const [before] = await admin`select status from dose_events where id = ${f.doses[0]!}`;
      expect(before!["status"]).toBe("missed");
      await confirmDose(f.admin, f.doses[0]!, late);
      const [after] = await admin`select status, confirmed_by_member_id, confirmed_at from dose_events where id = ${f.doses[0]!}`;
      expect(after).toMatchObject({ status: "taken", confirmed_by_member_id: f.admin.memberId });
      expect((after!["confirmed_at"] as Date).toISOString()).toBe(late.toISOString());
      expect(await balance(f)).toBe(9);
    });

    it("sem estoque registrado a dose é confirmada e nada é descontado", async () => {
      const f = await novaFamilia("SemEstoque");
      const r = await confirmDose(f.admin, f.doses[0]!, NOON);
      expect(r.stockDeducted).toBe(false);
      const [c] = await admin`select count(*)::int as n from stock_movements where family_id = ${f.familyId}`;
      expect(c!["n"]).toBe(0);
    });

    it("dose de outra família não existe (e confirmar não faz nada)", async () => {
      const a = await novaFamilia("DonaA");
      const b = await novaFamilia("DonaB");
      await expect(confirmDose(b.admin, a.doses[0]!, NOON)).rejects.toBeInstanceOf(UserError);
      const [d] = await admin`select status from dose_events where id = ${a.doses[0]!}`;
      expect(d!["status"]).toBe("pending");
    });

    it("lembrar de novo registra o pedido (remind_again_at) e valida os minutos", async () => {
      const f = await novaFamilia("Soneca");
      await snoozeDose(f.admin, f.doses[0]!, 15, NOON);
      const [d] = await admin`select remind_again_at from dose_events where id = ${f.doses[0]!}`;
      expect((d!["remind_again_at"] as Date).toISOString()).toBe(new Date(NOON.getTime() + 15 * 60_000).toISOString());
      await expect(snoozeDose(f.admin, f.doses[0]!, 7, NOON)).rejects.toBeInstanceOf(UserError);
      await confirmDose(f.admin, f.doses[0]!, NOON);
      await expect(snoozeDose(f.admin, f.doses[0]!, 15, NOON)).rejects.toBeInstanceOf(UserError); // já tomada
    });

    it("confirmar, desfazer e ajustar vão para a auditoria sem texto livre nem dado clínico", async () => {
      const f = await novaFamilia("Audit");
      await registerPurchase(f.admin, f.medId, 10, "farmácia do João", NOON);
      await adjustStock(f.admin, f.medId, 8, "caiu no chão e perdi dois", NOON);
      await confirmDose(f.admin, f.doses[0]!, NOON);
      await undoDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 3000));
      const rows = await admin`select action, meta from audit_log where family_id = ${f.familyId} and action like any(array['dose.%','stock.%'])`;
      expect(rows.map((r) => r["action"]).sort()).toEqual(["dose.confirm", "dose.undo", "stock.adjust", "stock.purchase"]);
      const all = JSON.stringify(rows);
      expect(all).not.toContain("farmácia");
      expect(all).not.toContain("caiu no chão");
    });
  });

  describe("estoque", () => {
    it("compra e ajuste: o saldo é a soma dos movimentos; o ajuste guarda só a diferença", async () => {
      const f = await novaFamilia("Estoque");
      await registerPurchase(f.admin, f.medId, 30, undefined, NOON);
      await adjustStock(f.admin, f.medId, 25, "conferi a caixa", NOON);
      expect(await balance(f)).toBe(25);
      const rows = await admin`select type, quantity, note from stock_movements where family_id = ${f.familyId} order by created_at, quantity desc`;
      expect(rows.map((r) => [r["type"], r["quantity"]])).toEqual([["purchase", 30], ["adjustment", -5]]);
      await expect(adjustStock(f.admin, f.medId, 25, "", NOON)).rejects.toThrow(/mesma/);
      await expect(registerPurchase(f.admin, f.medId, 0, undefined, NOON)).rejects.toBeInstanceOf(UserError);
      await expect(registerPurchase(f.admin, f.medId, -3, undefined, NOON)).rejects.toBeInstanceOf(UserError);
      await expect(adjustStock(f.admin, f.medId, -1, "", NOON)).rejects.toBeInstanceOf(UserError);
    });

    it("estoque inicial no cadastro vira uma compra de abertura", async () => {
      const f = await novaFamilia("Inicial");
      const id = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Com estoque", alternatives: [], route: "tablet", controlUnit: "unit", initialStock: 10 });
      const rows = await admin`select m.type, m.quantity, m.note from stock_movements m join stock_items i on i.id = m.stock_item_id where i.medication_id = ${id}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "purchase", quantity: 10, note: "Saldo inicial" });
    });

    it("colírio é estimativa; a previsão muda ao trocar a fase", async () => {
      const f = await novaFamilia("Colirio");
      const id = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Colírio", alternatives: [], route: "drops", controlUnit: "drop", dropsPerMl: 20, initialStock: 120 });
      const [item] = await admin`select is_estimate from stock_items where medication_id = ${id}`;
      expect(item!["is_estimate"]).toBe(true);
      await meds.saveScheme(f.admin, id, { startDate: DAY, firstTime: "00:00", phases: [{ everyHours: 6, fromDay: 1, toDay: null, perDose: 1 }] }); // 4 gotas/dia
      const slow = await previewStockDays(f.admin, id, 0, NOON);
      await meds.saveScheme(f.admin, id, { startDate: DAY, firstTime: "00:00", phases: [{ everyHours: 3, fromDay: 1, toDay: null, perDose: 1 }] }); // 8 gotas/dia
      const fast = await previewStockDays(f.admin, id, 0, NOON);
      expect(slow).toBeGreaterThan(fast);
      const snap = await buildSnapshot(ctxOf(f.admin), NOON);
      const m = snap.medications.find((x) => x.id === id)!;
      expect(m.stock.approximate).toBe(true);
      expect(m.stock.quantityText).toContain("≈ 6,0 ml");
      expect(m.stock.quantityText).toContain("120 gotas");
    });

    it("o retrato mostra saldo, dias restantes, nível e movimentações; Confirmador não vê estoque", async () => {
      const f = await novaFamilia("Retrato");
      await registerPurchase(f.admin, f.medId, 30, undefined, NOON);
      await confirmDose(f.admin, f.doses[0]!, NOON);
      const snap = await buildSnapshot(ctxOf(f.admin), NOON);
      const m = snap.medications[0]!;
      expect(m.stock).toMatchObject({ quantity: 29, level: "warning", tracked: true, thresholdDays: 7 });
      expect(m.stock.daysLeft).toBeGreaterThanOrEqual(9);
      expect(snap.stockMovements.map((x) => x.text).join("|")).toContain("Compra");
      expect(snap.doses).toHaveLength(3);
      expect(snap.doses.find((d) => d.status === "taken")).toMatchObject({ doneBy: "Admin Retrato", channel: "panel", time: "06:00" });
      expect(snap.recentTaken).toHaveLength(1);

      const conf = await membro(f.familyId, "Confirmador", "Confirma");
      const sc = await buildSnapshot(ctxOf(conf), NOON);
      expect(sc.stockMovements).toEqual([]);
      expect(sc.medications[0]!.stock.quantity).toBe(0);
      expect(sc.medications[0]!.stock.tracked).toBe(false);
      expect(sc.doses).toHaveLength(3); // vê as doses (a próxima) e pode dar o check
    });
  });

  describe("atraso e esquecida (janelas da família)", () => {
    it("15 min = atrasada, 2 h = esquecida; o retrato calcula na leitura e a rotina grava", async () => {
      const f = await novaFamilia("Janelas");
      const at = (min: number) => new Date(new Date("2026-10-19T09:00:00Z").getTime() + min * 60_000); // dose das 06:00 local
      const st = async (now: Date) => (await buildSnapshot(ctxOf(f.admin), now)).doses[0]!.status;
      expect(await st(at(14))).toBe("pending");
      expect(await st(at(15))).toBe("late");
      expect(await st(at(119))).toBe("late");
      expect(await st(at(120))).toBe("missed");
      expect((await buildSnapshot(ctxOf(f.admin), at(40))).doses[0]!.whenLabel).toBe("Atrasada há 40 min");
      expect(await refreshDoseStatuses(f.familyId, settings, at(40))).toBe(1);
      expect((await admin`select status from dose_events where id = ${f.doses[0]!}`)[0]!["status"]).toBe("late");
      await refreshDoseStatuses(f.familyId, settings, at(130));
      expect((await admin`select status from dose_events where id = ${f.doses[0]!}`)[0]!["status"]).toBe("missed");
    });

    it("as janelas são configuráveis por família e validadas", async () => {
      const f = await novaFamilia("Config");
      await saveNoticeSettings(f.admin, { lateAfterMin: 30, missedAfterMin: 60 }, NOON);
      const [fam] = await admin`select settings from families where id = ${f.familyId}`;
      expect(fam!["settings"]).toMatchObject({ late_after_min: 30, missed_after_min: 60 });
      await expect(saveNoticeSettings(f.admin, { lateAfterMin: 90 }, NOON)).rejects.toThrow(/maior que o de atraso/);
      await expect(saveNoticeSettings(f.admin, { leadDays: 0 }, NOON)).rejects.toBeInstanceOf(UserError);
    });
  });

  describe("aviso de estoque baixo", () => {
    it("cria o aviso uma só vez ao cruzar o limite, só para quem pode comprar/administrar", async () => {
      const f = await novaFamilia("Aviso");
      const familiar = await membro(f.familyId, "Familiar", "Filha");
      const cuidadora = await membro(f.familyId, "Cuidadora", "Cuida");
      const confirmador = await membro(f.familyId, "Confirmador", "Confirma");
      const desativada = await membro(f.familyId, "Familiar", "Desativada", { active: false });
      const convidada = await membro(f.familyId, "Familiar", "Convidada", { accessState: "invited" });

      await registerPurchase(f.admin, f.medId, 30, undefined, NOON); // 10 dias: acima do limite (7)
      expect(await noticesOf(f)).toHaveLength(0);
      await adjustStock(f.admin, f.medId, 15, "conferi", NOON); // ~5 dias: cruzou
      const n1 = await noticesOf(f);
      expect(n1.map((n) => n.member_id).sort()).toEqual([f.admin.memberId, familiar.memberId].sort());
      for (const outra of [cuidadora, confirmador, desativada, convidada]) expect(n1.some((n) => n.member_id === outra.memberId)).toBe(false);

      // mais baixas, desfazer, reconfirmar: continua um aviso por pessoa
      await confirmDose(f.admin, f.doses[0]!, NOON);
      await undoDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 2000));
      await confirmDose(f.admin, f.doses[0]!, new Date(NOON.getTime() + 4000));
      await confirmDose(f.admin, f.doses[1]!, NOON);
      await evaluateLowStockForFamily(f.familyId, NOON);
      await prepareDay(ctxOf(f.admin), NOON);
      expect(await noticesOf(f)).toHaveLength(2);

      // texto do aviso: remédio + paciente (primeiro nome); sem texto livre
      const mine = await listNotices(f.admin, NOON);
      expect(mine.unread).toBe(1);
      expect(mine.notices[0]).toMatchObject({ kind: "low_stock", read: false });
      expect(mine.notices[0]!.title).toBe("Estoque baixo: Remédio Aviso (Paciente)");
      expect(mine.notices[0]!.href).toContain("/configuracoes/estoque?med=");
    });

    it("nova compra abre um ciclo novo: cruzar o limite de novo avisa de novo", async () => {
      const f = await novaFamilia("Ciclo");
      await registerPurchase(f.admin, f.medId, 12, undefined, NOON); // já abaixo: avisa
      expect(await noticesOf(f)).toHaveLength(1);
      await registerPurchase(f.admin, f.medId, 60, undefined, NOON); // volta ao normal
      expect(await noticesOf(f)).toHaveLength(1);
      await adjustStock(f.admin, f.medId, 12, "perda", NOON); // cruza de novo, mesmo ciclo de compra? não: o ajuste não é entrada
      expect(await noticesOf(f)).toHaveLength(2);
    });

    it("limite por remédio e padrão da família: subir o limite avisa na hora", async () => {
      const f = await novaFamilia("Limite");
      await registerPurchase(f.admin, f.medId, 30, undefined, NOON); // 10 dias
      expect(await noticesOf(f)).toHaveLength(0);
      await saveNoticeSettings(f.admin, { leadDays: 12 }, NOON);
      expect(await noticesOf(f)).toHaveLength(1);
      const snap = await buildSnapshot(ctxOf({ ...f.admin, settings: familySettingsSchema.parse({ default_low_stock_days: 12 }) }), NOON);
      expect(snap.notifications.leadDays).toBe(12);
      expect(snap.medications[0]!.stock.level).toBe("critical");
      await saveNoticeSettings(f.admin, { exceptions: [{ medicationId: f.medId, days: 3 }] }, NOON);
      const snap2 = await buildSnapshot(ctxOf(f.admin), NOON);
      expect(snap2.notifications.exceptions).toEqual([{ medicationId: f.medId, days: 3 }]);
      expect(snap2.medications[0]!.stock.thresholdDays).toBe(3);
    });

    it("quem tem WhatsApp ou não vê o aviso do mesmo jeito no portal; marcar como lido é só da própria pessoa", async () => {
      const f = await novaFamilia("Lido");
      const familiar = await membro(f.familyId, "Familiar", "Filha", {}); // sem WhatsApp verificado
      await registerPurchase(f.admin, f.medId, 12, undefined, NOON);
      expect((await listNotices(familiar, NOON)).unread).toBe(1);
      await markNoticesRead(familiar, undefined, NOON);
      expect((await listNotices(familiar, NOON)).unread).toBe(0);
      expect((await listNotices(f.admin, NOON)).unread).toBe(1); // o da outra pessoa continua não lido
      // tentar ler o aviso de outra pessoa pelo id não afeta nada
      const adminNotice = (await listNotices(f.admin, NOON)).notices[0]!;
      await markNoticesRead(familiar, [adminNotice.id], NOON);
      expect((await listNotices(f.admin, NOON)).unread).toBe(1);
      const snap = await buildSnapshot(ctxOf(f.admin), NOON);
      expect(snap.unreadNotices).toBe(1);
      expect(snap.notices![0]!.title).toContain("Estoque baixo");
      const [n] = await admin`select whatsapp_sent_at from notifications where family_id = ${f.familyId} limit 1`;
      expect(n!["whatsapp_sent_at"]).toBeNull(); // o envio pelo WhatsApp é do Lote 4
    });
  });

  describe("permissões recusadas no servidor", () => {
    it("Confirmador só dá o check: estoque, histórico e avisos são recusados", async () => {
      const f = await novaFamilia("Perm");
      const c = await membro(f.familyId, "Confirmador", "Confirma");
      await expect(registerPurchase(c, f.medId, 5, undefined, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(adjustStock(c, f.medId, 5, "", NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(previewStockDays(c, f.medId, 5, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listDoseHistory(c, {}, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(saveNoticeSettings(c, { leadDays: 5 }, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(meds.createMedication(c, { patientId: f.patientId, name: "X", alternatives: [], route: "tablet", controlUnit: "unit", initialStock: 5 })).rejects.toBeInstanceOf(ForbiddenError);
      await confirmDose(c, f.doses[0]!, NOON); // o check é permitido
      expect((await admin`select status from dose_events where id = ${f.doses[0]!}`)[0]!["status"]).toBe("taken");
    });

    it("sem a permissão de confirmar, a dose não é confirmada nem desfeita nem adiada", async () => {
      const f = await novaFamilia("SemCheck");
      const sem = actorOf(f.familyId, f.admin.memberId, "Visitante", "Visitante", { "dashboard.view": true, "patients.view": true });
      await expect(confirmDose(sem, f.doses[0]!, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(undoDose(sem, f.doses[0]!, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(snoozeDose(sem, f.doses[0]!, 15, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await admin`select status from dose_events where id = ${f.doses[0]!}`)[0]!["status"]).toBe("pending");
    });

    it("Cuidadora vê histórico mas não ajusta estoque; Familiar compra mas não muda configurações", async () => {
      const f = await novaFamilia("Perfis");
      const cuid = await membro(f.familyId, "Cuidadora", "Cuida");
      const fam = await membro(f.familyId, "Familiar", "Fam");
      await expect(listDoseHistory(cuid, {}, NOON)).resolves.toBeTruthy();
      await expect(registerPurchase(cuid, f.medId, 5, undefined, NOON)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(registerPurchase(fam, f.medId, 5, undefined, NOON)).resolves.toBeUndefined();
      await expect(saveNoticeSettings(fam, { leadDays: 5 }, NOON)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("paciente com conta confirma a própria dose e a de outro paciente, conforme a permissão", async () => {
      const f = await novaFamilia("Paciente");
      const adelino = await membro(f.familyId, "Cuidadora", "Adelino"); // tem doses.confirm
      const pid = await patients.savePatient(f.admin, { name: "Adelino Souza", birthDate: "", notes: "", usesPhone: true, selfMemberId: adelino.memberId });
      const m2 = await meds.createMedication(f.admin, { patientId: pid, name: "Losartana", alternatives: [], route: "tablet", controlUnit: "unit" });
      await meds.saveScheme(f.admin, m2, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 24, fromDay: 1, toDay: null, perDose: 1 }] }); // o esquema padrão começa hoje: fixa o dia do teste
      await ensureDosesForDay(f.familyId, DAY);
      const [propria] = await admin`select id from dose_events where family_id = ${f.familyId} and medication_id = ${m2}`;
      await expect(confirmDose(adelino, propria!["id"] as string, NOON)).resolves.toBeTruthy(); // própria
      await expect(confirmDose(adelino, f.doses[0]!, NOON)).resolves.toBeTruthy(); // de outro paciente
      const semPermissao = actorOf(f.familyId, adelino.memberId, "Cuidadora", "Adelino", { ...permsOf("Cuidadora"), "doses.confirm": false });
      await expect(confirmDose(semPermissao, f.doses[1]!, NOON)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("histórico de doses", () => {
    it("filtra por paciente, remédio, pessoa, período e situação; mostra quem deu e quando", async () => {
      const f = await novaFamilia("Hist");
      const outra = await membro(f.familyId, "Familiar", "Outra");
      await registerPurchase(f.admin, f.medId, 20, undefined, NOON);
      const t14 = new Date("2026-10-19T17:05:00Z");
      await confirmDose(f.admin, f.doses[0]!, new Date("2026-10-19T09:03:00Z"));
      await confirmDose(outra, f.doses[1]!, t14);
      const now = new Date("2026-10-19T20:00:00Z"); // 17:00 local: doses 06:00 e 14:00 já passaram
      const all = await listDoseHistory(f.admin, {}, now);
      expect(all.rows).toHaveLength(2);
      expect(all.rows[0]).toMatchObject({ time: "14:00", status: "taken", who: "Outra", channel: "panel", dateLabel: "19/10/2026" });
      expect(all.rows[1]).toMatchObject({ time: "06:00", who: "Admin Hist" });
      expect(all.rows[0]!.doneLabel).toBe("19/10 às 14:05");
      expect(all.people.map((p) => p.name).sort()).toEqual(["Admin Hist", "Outra"]);
      expect((await listDoseHistory(f.admin, { memberId: outra.memberId }, now)).rows).toHaveLength(1);
      expect((await listDoseHistory(f.admin, { patientId: randomUUID() }, now)).rows).toHaveLength(0);
      expect((await listDoseHistory(f.admin, { medicationId: f.medId, from: DAY, to: DAY }, now)).rows).toHaveLength(2);
      expect((await listDoseHistory(f.admin, { from: "2026-10-20", to: "2026-10-21" }, now)).rows).toHaveLength(0);
      expect((await listDoseHistory(f.admin, { status: "taken" }, now)).rows).toHaveLength(2);
      expect((await listDoseHistory(f.admin, { status: "missed" }, now)).rows).toHaveLength(0);
      const later = new Date("2026-10-20T05:00:00Z"); // 02:00 do dia seguinte: a das 22:00 já passou há horas -> esquecida (calculada na leitura)
      const missed = await listDoseHistory(f.admin, { status: "missed" }, later);
      expect(missed.rows).toHaveLength(1);
      expect(missed.rows[0]).toMatchObject({ time: "22:00", who: "" });
    });
  });

  describe("RLS entre famílias nas tabelas do lote", () => {
    it("outra família não lê nem altera doses, estoque, movimentos e avisos", async () => {
      const a = await novaFamilia("RlsA");
      const b = await novaFamilia("RlsB");
      await registerPurchase(a.admin, a.medId, 12, undefined, NOON);
      await confirmDose(a.admin, a.doses[0]!, NOON);
      expect((await noticesOf(a)).length).toBeGreaterThan(0);

      for (const t of [s.doseEvents, s.stockItems, s.stockMovements, s.notifications] as const) {
        const seen = await withFamilia(b.familyId, (tx) => tx.select({ familyId: t.familyId }).from(t));
        expect(seen.every((r) => r.familyId === b.familyId)).toBe(true);
      }
      // atualizar/apagar as linhas da A pela B não atinge nada
      const upd = await withFamilia(b.familyId, (tx) => tx.update(s.doseEvents).set({ status: "skipped" }).where(eq(s.doseEvents.id, a.doses[1]!)).returning());
      expect(upd).toHaveLength(0);
      const del = await withFamilia(b.familyId, (tx) => tx.delete(s.notifications).where(eq(s.notifications.familyId, a.familyId)).returning());
      expect(del).toHaveLength(0);
      // inserir em nome da A estando na B é recusado pelo WITH CHECK
      await expect(withFamilia(b.familyId, (tx) => tx.insert(s.notifications).values({ familyId: a.familyId, memberId: a.admin.memberId, kind: "low_stock", title: "x", dedupeKey: randomUUID() }))).rejects.toThrow();
      // a dose da A segue intacta
      expect((await admin`select status from dose_events where id = ${a.doses[1]!}`)[0]!["status"]).toBe("pending");
      const rows = await withFamilia(a.familyId, (tx) => tx.select().from(s.stockMovements).where(and(eq(s.stockMovements.familyId, a.familyId))));
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
