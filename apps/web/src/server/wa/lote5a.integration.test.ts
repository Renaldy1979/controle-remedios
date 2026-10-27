// @vitest-environment node
/**
 * Lote 5A: QUEM RECEBE CADA AVISO por perfil (Administrador, Familiar, Cuidadora, Confirmador e Somente leitura).
 * Regra geral: aviso de ação só vai a quem pode agir sobre ele; o resumo diário vai a todos com `dashboard.view`.
 * Papel da APLICAÇÃO (sem BYPASSRLS). Sem o banco no ar, a suíte é PULADA (REQUIRE_DB=1 falha).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, telefoneAleatorio, type Admin } from "@medcuidar/pg-testing";
import { READ_ONLY_PROFILE_NAME, SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import { ensureDosesForDay } from "../pg/doses";
import { createFamilyWithAdmin } from "../pg/families";
import * as meds from "../pg/medications";
import * as patients from "../pg/patients";
import { adjustStock, registerPurchase } from "../pg/stock";
import { gerarMensagens } from "./fila";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes do Lote 5A (avisos) PULADOS. Rode `pnpm db:up`.");

const TZ = "America/Sao_Paulo";
const DAY = "2026-10-19";
const T0610 = new Date("2026-10-19T09:10:00Z"); // 06:10: a dose das 06:00 está na hora
const TARDE = new Date("2026-10-19T12:30:00Z"); // 09:30: a das 06:00 passou de 2 h (esquecida)
const NOITE = new Date("2026-10-19T23:30:00Z"); // 20:30: horário do resumo
const settings = familySettingsSchema.parse({});
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;

const PERFIS = ["Administrador", "Familiar", "Cuidadora", "Confirmador", READ_ONLY_PROFILE_NAME] as const;
type Perfil = (typeof PERFIS)[number];

describe.skipIf(!up)("Lote 5A — destinatários dos avisos por perfil", () => {
  let admin: Admin;
  const criadas: string[] = [];

  interface Fam { familyId: string; membros: Record<Perfil, string>; patientId: string; medId: string; stockItemId: string }

  async function novaFamilia(nome: string): Promise<Fam> {
    const r = await createFamilyWithAdmin({ appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}` });
    criadas.push(r.familyId);
    const a = { familyId: r.familyId, memberId: r.memberId, timezone: TZ, settings, member: { id: r.memberId, name: "Admin", profileName: "Administrador", permissions: permsOf("Administrador") } };
    await withFamilia(r.familyId, (tx) => tx.update(s.members).set({ phoneVerified: telefoneAleatorio() }).where(eq(s.members.id, r.memberId)));
    const membros = { Administrador: r.memberId } as Record<Perfil, string>;
    for (const perfil of PERFIS.slice(1)) {
      membros[perfil] = await withFamilia(r.familyId, async (tx) => {
        const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, perfil));
        const [m] = await tx.insert(s.members).values({
          familyId: r.familyId, profileId: p!.id, name: perfil, email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: "active",
          appwriteUserId: `zz-test-${randomUUID()}`, emailConfirmedAt: new Date(), phoneVerified: telefoneAleatorio(),
        }).returning({ id: s.members.id });
        return m!.id;
      });
    }
    const patientId = await patients.savePatient(a, { name: `Adelino${nome}`, birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medId = await meds.createMedication(a, { patientId, name: `Zypred${nome}`, alternatives: [], route: "tablet", controlUnit: "unit" });
    await meds.saveScheme(a, medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
    await registerPurchase(a, medId, 30, "Saldo inicial", T0610);
    await ensureDosesForDay(r.familyId, DAY);
    const [item] = await admin`select id from stock_items where family_id = ${r.familyId}`;
    return { familyId: r.familyId, membros, patientId, medId, stockItemId: item!["id"] as string };
  }

  /** Perfis que receberam mensagens do tipo (na ordem de PERFIS). */
  async function quem(f: Fam, kind: string): Promise<Perfil[]> {
    const rows = await admin`select distinct member_id from outbound_messages where family_id = ${f.familyId} and kind = ${kind}`;
    const ids = new Set(rows.map((r) => r["member_id"] as string));
    return PERFIS.filter((p) => ids.has(f.membros[p]));
  }

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
  });
  afterAll(async () => {
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  it("lembrete de dose: só quem pode confirmar (o leitor não recebe)", async () => {
    const f = await novaFamilia("Lembrete");
    await gerarMensagens(f.familyId, T0610);
    expect(await quem(f, "dose_reminder")).toEqual(["Administrador", "Familiar", "Cuidadora", "Confirmador"]);
  });

  it("dose esquecida: só quem pode confirmar; também no caminho de reserva (ninguém marcado em 'avisos da família')", async () => {
    // reserva: ninguém marcou receives_family_alerts → antes ia a todos com dashboard.view (incluindo o leitor)
    const f = await novaFamilia("EsquecidaReserva");
    await gerarMensagens(f.familyId, TARDE);
    expect(await quem(f, "dose_missed")).toEqual(["Administrador", "Familiar", "Cuidadora", "Confirmador"]);

    // só o leitor marcado para receber os avisos da família: marcado mas sem poder agir → cai na reserva, sem ele
    const g = await novaFamilia("EsquecidaSoLeitor");
    await withFamilia(g.familyId, (tx) => tx.update(s.members).set({ receivesFamilyAlerts: true }).where(eq(s.members.id, g.membros[READ_ONLY_PROFILE_NAME])));
    await gerarMensagens(g.familyId, TARDE);
    expect(await quem(g, "dose_missed")).toEqual(["Administrador", "Familiar", "Cuidadora", "Confirmador"]);

    // leitor e familiar marcados: só o familiar (que pode agir) recebe
    const h = await novaFamilia("EsquecidaMarcados");
    await withFamilia(h.familyId, (tx) => tx.update(s.members).set({ receivesFamilyAlerts: true }).where(eq(s.members.familyId, h.familyId)));
    await withFamilia(h.familyId, (tx) => tx.update(s.members).set({ receivesFamilyAlerts: false }).where(eq(s.members.id, h.membros.Cuidadora)));
    await gerarMensagens(h.familyId, TARDE);
    expect(await quem(h, "dose_missed")).toEqual(["Administrador", "Familiar", "Confirmador"]);
  });

  it("estoque baixo, receita vencendo e reposição: só quem pode agir (comprar/ajustar, anexar receita, reposição)", async () => {
    const f = await novaFamilia("Acao");
    const a = { familyId: f.familyId, memberId: f.membros.Administrador, timezone: TZ, settings, member: { id: f.membros.Administrador, name: "Admin", profileName: "Administrador", permissions: permsOf("Administrador") } };
    // caminho natural: o saldo cai e o portal cria o aviso só para quem pode comprar
    await adjustStock(a, f.medId, 6, "conferi", T0610);
    const sino = await admin`select distinct member_id from notifications where family_id = ${f.familyId} and kind = 'low_stock'`;
    const peloPortal = PERFIS.filter((p) => sino.some((r) => r["member_id"] === f.membros[p]));
    expect(peloPortal).toEqual(["Administrador", "Familiar"]);

    // segunda trava no WhatsApp: mesmo que existam avisos para TODOS (dados antigos ou de outra origem), só quem pode agir recebe
    const payload = { medicationId: f.medId, patientId: f.patientId, stockItemId: f.stockItemId, daysLeft: 2 };
    await withFamilia(f.familyId, async (tx) => {
      for (const p of PERFIS) {
        const m = f.membros[p];
        await tx.insert(s.notifications).values([
          { familyId: f.familyId, memberId: m, kind: "low_stock", title: "Estoque baixo", body: "", payload, dedupeKey: `zz-ls-${p}`, createdAt: T0610 },
          { familyId: f.familyId, memberId: m, kind: "prescription_expiring", title: "Receita vence em 7 dias", body: "Zypred", payload: {}, dedupeKey: `zz-rx-${p}`, createdAt: T0610 },
          { familyId: f.familyId, memberId: m, kind: "replenishment_update", title: "Reposição: comprado", body: "Zypred", payload: {}, dedupeKey: `zz-rep-${p}`, createdAt: T0610 },
        ]).onConflictDoNothing();
      }
    });
    await gerarMensagens(f.familyId, T0610);
    expect(await quem(f, "low_stock")).toEqual(["Administrador", "Familiar"]);
    expect(await quem(f, "rx_expiring")).toEqual(["Administrador", "Familiar"]); // Cuidadora vê receita mas não anexa nem repõe
    expect(await quem(f, "replenishment")).toEqual(["Administrador", "Familiar"]);
  });

  it("resumo diário: todos com dashboard.view, inclusive o leitor; quem deu PARAR não recebe; sem repetir", async () => {
    const f = await novaFamilia("Resumo");
    await withFamilia(f.familyId, (tx) => tx.update(s.members).set({ whatsappOptOutAt: new Date() }).where(eq(s.members.id, f.membros.Cuidadora)));
    await gerarMensagens(f.familyId, NOITE);
    expect(await quem(f, "daily_summary")).toEqual(["Administrador", "Familiar", "Confirmador", READ_ONLY_PROFILE_NAME]);
    const n = (await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId} and kind = 'daily_summary'`)[0]!["n"];
    await gerarMensagens(f.familyId, NOITE);
    expect((await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId} and kind = 'daily_summary'`)[0]!["n"]).toBe(n);
  });

  it("o leitor recebe SÓ o resumo diário: depois de um dia inteiro de avisos, é o único tipo que ele tem", async () => {
    const f = await novaFamilia("SoResumo");
    for (const t of [T0610, TARDE, NOITE]) await gerarMensagens(f.familyId, t);
    const meus = await admin`select distinct kind from outbound_messages where family_id = ${f.familyId} and member_id = ${f.membros[READ_ONLY_PROFILE_NAME]}`;
    expect(meus.map((r) => r["kind"])).toEqual(["daily_summary"]);
    // e o resumo dele não traz botões de ação
    const [r] = await admin`select body, options from outbound_messages where family_id = ${f.familyId} and member_id = ${f.membros[READ_ONLY_PROFILE_NAME]} and kind = 'daily_summary'`;
    expect(r!["options"]).toEqual([]);
  });
});
