// @vitest-environment node
/**
 * Integração do Lote 4A contra o Postgres local (pnpm db:up), com o papel da APLICAÇÃO (sem BYPASSRLS): conversa em código,
 * verificação do número, convite por WhatsApp, fila de saída e a API /api/v1 (chaves, X-Telefone, Idempotency-Key).
 * Sem o banco no ar, a suíte é PULADA. O Appwrite não é tocado (o primeiro acesso completo é coberto no e2e).
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  criarChavePlataforma, gerarCodigoVerificacao, hashConviteCodigo, resolverLinkPrimeiroAcesso, revogarChavePlataforma, sha256,
  VALIDADE_CONVITE_MS, withFamilia,
} from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts } from "@medcuidar/domain";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, prepararBanco, telefoneAleatorio, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import * as h from "../api/handlers";
import { _limparLimites } from "../api/core";
import { ensureDosesForDay } from "../pg/doses";
import { createFamilyWithAdmin } from "../pg/families";
import * as meds from "../pg/medications";
import * as patients from "../pg/patients";
import { adjustStock, registerPurchase } from "../pg/stock";
import { loadWaActor, resolveSender } from "./actor";
import { conversa, processarMensagem } from "./conversa";
import { gerarMensagens, marcarEnviada, pendentes } from "./fila";
import { criarChaveFamilia, listarChavesFamilia, revogarChaveFamilia } from "./keys";
import { startPhoneVerification } from "./phone-verify";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes de integração do Lote 4A PULADOS. Rode `pnpm db:up`.");

const TZ = "America/Sao_Paulo";
const DAY = "2026-10-19";
/** 06:10 em São Paulo: a dose das 06:00 está na hora (ainda "pendente"). */
const T0610 = new Date("2026-10-19T09:10:00Z");
/** 14:10: as doses das 06:00 e das 14:00 estão abertas ao mesmo tempo. */
const T1410 = new Date("2026-10-19T17:10:00Z");
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;
const settings = familySettingsSchema.parse({});

interface Fam {
  familyId: string;
  adminId: string;
  patientId: string;
  medId: string;
  doses: string[];
  /** DoseActor do administrador, para as funções de cadastro/estoque */
  admin: Parameters<typeof meds.createMedication>[0];
}

describe.skipIf(!up)("Lote 4A — WhatsApp: API, conversa e fila no Postgres", () => {
  let admin: Admin;
  const criadas: string[] = [];
  const chavesPlataforma: string[] = [];
  let cpl: string;

  const actorDe = (familyId: string, memberId: string, profileName: string, name: string) => ({
    familyId, memberId, timezone: TZ, settings, member: { id: memberId, name, profileName, permissions: permsOf(profileName) },
  });

  /** Família com 1 paciente, 1 remédio de 8 em 8 h (06:00, 14:00, 22:00) com 10 comprimidos. O administrador tem número VERIFICADO. */
  async function novaFamilia(nome: string, opts: { adminPhone?: string | null } = {}): Promise<Fam & { adminPhone: string | null }> {
    const r = await createFamilyWithAdmin({
      appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}`,
    });
    criadas.push(r.familyId);
    const a = actorDe(r.familyId, r.memberId, "Administrador", `Admin ${nome}`);
    const adminPhone = opts.adminPhone === undefined ? telefoneAleatorio() : opts.adminPhone;
    if (adminPhone) await withFamilia(r.familyId, (tx) => tx.update(s.members).set({ phoneVerified: adminPhone }).where(eq(s.members.id, r.memberId)));
    const patientId = await patients.savePatient(a, { name: `Adelino ${nome}`, birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medId = await meds.createMedication(a, { patientId, name: `Zypred${nome}`, alternatives: [], route: "tablet", controlUnit: "unit" });
    await meds.saveScheme(a, medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
    await registerPurchase(a, medId, 10, "Saldo inicial");
    await ensureDosesForDay(r.familyId, DAY);
    const doses = await withFamilia(r.familyId, (tx) => tx.select({ id: s.doseEvents.id }).from(s.doseEvents).orderBy(s.doseEvents.scheduledAt));
    return { familyId: r.familyId, adminId: r.memberId, patientId, medId, doses: doses.map((d) => d.id), admin: a, adminPhone };
  }

  async function pessoa(
    familyId: string, profileName: string, nome: string,
    extra: { phone?: string | null; state?: "active" | "whatsapp_verified" | "invited"; pending?: string | null } = {},
  ): Promise<{ id: string; phone: string | null }> {
    const state = extra.state ?? "active";
    const phone = extra.phone === undefined ? telefoneAleatorio() : extra.phone;
    const id = await withFamilia(familyId, async (tx) => {
      const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, profileName));
      const [m] = await tx
        .insert(s.members)
        .values({
          familyId, profileId: p!.id, name: nome, email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: state,
          appwriteUserId: state === "active" ? `zz-test-${randomUUID()}` : null, emailConfirmedAt: state === "active" ? new Date() : null,
          phoneVerified: state === "invited" ? null : phone, phonePending: extra.pending ?? null,
        })
        .returning({ id: s.members.id });
      return m!.id;
    });
    return { id, phone };
  }

  const movimentosDeDose = async (doseId: string) => (await admin`select * from stock_movements where dose_event_id = ${doseId}`).length;
  const saldo = async (f: Fam) => {
    const [r] = await admin`select coalesce(sum(m.quantity), 0)::float8 as total from stock_movements m join stock_items i on i.id = m.stock_item_id where i.family_id = ${f.familyId} and i.medication_id = ${f.medId}`;
    return r!["total"] as number;
  };

  const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    new NextRequest(`http://api.test/api/v1${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const semParams = { params: Promise.resolve({}) };
  const bearer = (k: string, tel?: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${k}`, ...(tel ? { "x-telefone": tel } : {}), ...extra });
  const msg = (tel: string, texto: string, key = cpl, extra: Record<string, string> = {}) =>
    h.conversaMensagem(req("POST", "/conversa/mensagem", bearer(key, tel, extra), { messageId: `m-${randomUUID()}`, texto }), semParams);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lerJson = async (r: Response) => (await r.json()) as { dados?: any; erro?: { codigo: string; mensagem: string } };

  beforeAll(async () => {
    process.env["APP_URL"] = "http://app.test";
    admin = conectarAdmin();
    await prepararBanco();
    const k = await criarChavePlataforma("zz-test conversa", ["conversa"]);
    chavesPlataforma.push(k.id);
    cpl = k.chave;
  });
  beforeEach(() => _limparLimites());
  afterAll(async () => {
    for (const id of chavesPlataforma) await revogarChavePlataforma(id);
    await admin`delete from platform_audit_log where key_id in (select id from platform_api_keys where name like 'zz-test%')`;
    await admin`delete from platform_api_keys where name like 'zz-test%'`;
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await admin`delete from phone_lockouts where phone like '5599%'`;
    await encerrar(admin);
  });

  /* ------------------------------------------------------------ identificação pelo telefone */
  describe("remetente: só número verificado é atendido", () => {
    it("desconhecido, pendente e sem acesso recebem a MESMA resposta genérica (nada é revelado)", async () => {
      const f = await novaFamilia("Gen");
      const pend = telefoneAleatorio();
      await pessoa(f.familyId, "Familiar", "Pendente", { phone: null, pending: pend });
      const convidado = await pessoa(f.familyId, "Familiar", "Convidado", { state: "invited" });
      const respostas: string[] = [];
      for (const tel of [telefoneAleatorio(), pend, convidado.phone ?? telefoneAleatorio()]) {
        const r = await lerJson(await msg(tel, "tomei"));
        expect(r.dados.intent).toBe("desconhecido");
        respostas.push(r.dados.respostas[0].texto);
      }
      expect(new Set(respostas).size).toBe(1);
      expect(respostas[0]).not.toMatch(/Adelino|Zypred|Família/);
    });

    it("membro desativado deixa de ser atendido", async () => {
      const f = await novaFamilia("Desat");
      const p = await pessoa(f.familyId, "Familiar", "Saiu");
      expect((await resolveSender(p.phone!))?.memberId).toBe(p.id);
      await withFamilia(f.familyId, (tx) => tx.update(s.members).set({ active: false, removedAt: new Date() }).where(eq(s.members.id, p.id)));
      expect(await resolveSender(p.phone!)).toBeNull();
    });
  });

  /* ------------------------------------------------------------ verificação do número */
  describe("código de verificação do número", () => {
    it("certo verifica; o código só vale uma vez; novo código invalida o anterior; trocar o número derruba o verificado", async () => {
      const f = await novaFamilia("Ver", { adminPhone: null });
      const tel = telefoneAleatorio();
      const v1 = await startPhoneVerification({ ...f.admin }, tel);
      const v2 = await startPhoneVerification({ ...f.admin }, tel);
      // o primeiro código foi cancelado pelo segundo
      const velho = await lerJson(await msg(tel, `CÓDIGO ${v1.code}`));
      expect(velho.dados.intent).toBe("codigo_invalido");
      const ok = await lerJson(await msg(tel, v2.code));
      expect(ok.dados.intent).toBe("numero_verificado");
      expect(ok.dados.respostas[0].texto).toContain("Número verificado");
      const [m] = await admin`select phone_verified, phone_pending, verification_code_hash from members where id = ${f.adminId}`;
      expect(m!["phone_verified"]).toBe(tel);
      expect(m!["phone_pending"]).toBeNull();
      expect(m!["verification_code_hash"]).toBeNull();
      // depois de verificado, quem escreve é atendido como membro
      expect((await resolveSender(tel))?.memberId).toBe(f.adminId);
      // trocar o número: o verificado deixa de valer até o novo ser confirmado
      const outro = telefoneAleatorio();
      await startPhoneVerification({ ...f.admin }, outro);
      expect(await resolveSender(tel)).toBeNull();
    });

    it("o código não fica em claro no banco (só o hash)", async () => {
      const f = await novaFamilia("Hash", { adminPhone: null });
      const v = await startPhoneVerification({ ...f.admin }, telefoneAleatorio());
      const [m] = await admin`select verification_code_hash, verification_expires_at from members where id = ${f.adminId}`;
      expect(m!["verification_code_hash"]).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(m)).not.toContain(v.code);
      const min = ((m!["verification_expires_at"] as Date).getTime() - Date.now()) / 60_000;
      expect(min).toBeGreaterThan(13);
      expect(min).toBeLessThanOrEqual(15);
    });

    it("código errado: 5 erros bloqueiam o número; depois nem o certo passa", async () => {
      const f = await novaFamilia("Err", { adminPhone: null });
      const tel = telefoneAleatorio();
      const v = await startPhoneVerification({ ...f.admin }, tel);
      const errado = v.code === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) await msg(tel, errado);
      const depois = await lerJson(await msg(tel, v.code));
      expect(depois.dados.intent).toBe("codigo_invalido");
      expect((await resolveSender(tel))).toBeNull();
    });

    it("código vencido não verifica", async () => {
      const f = await novaFamilia("Venc", { adminPhone: null });
      const tel = telefoneAleatorio();
      const v = await startPhoneVerification({ ...f.admin }, tel);
      await admin`update members set verification_expires_at = now() - interval '1 minute' where id = ${f.adminId}`;
      const r = await lerJson(await msg(tel, v.code));
      expect(r.dados.intent).toBe("codigo_invalido");
      expect(await resolveSender(tel)).toBeNull();
    });

    it("número que já é de outro usuário: 'em uso' e nada muda", async () => {
      const a = await novaFamilia("EmUsoA");
      const b = await novaFamilia("EmUsoB", { adminPhone: null });
      const v = await startPhoneVerification({ ...b.admin }, a.adminPhone!);
      const r = await lerJson(await msg(a.adminPhone!, v.code));
      // quem escreve já é membro verificado da família A: não é o fluxo de verificação
      expect(r.dados.intent).toBe("codigo");
      expect((await resolveSender(a.adminPhone!))?.familyId).toBe(a.familyId);
      const [m] = await admin`select phone_verified from members where id = ${b.adminId}`;
      expect(m!["phone_verified"]).toBeNull();
    });

    it("rota /telefone/verificar: só chave de plataforma; verifica pelo remetente real", async () => {
      const f = await novaFamilia("Rota", { adminPhone: null });
      const tel = telefoneAleatorio();
      const v = await startPhoneVerification({ ...f.admin }, tel);
      const fam = await criarChaveFamilia(f.admin, "zz-test");
      const comFamilia = await h.telefoneVerificar(req("POST", "/telefone/verificar", bearer(fam.chave, tel), { codigo: v.code }), semParams);
      expect(comFamilia.status).toBe(403);
      const errado = await h.telefoneVerificar(req("POST", "/telefone/verificar", bearer(cpl, tel), { codigo: v.code === "123456" ? "654321" : "123456" }), semParams);
      expect((await lerJson(errado)).dados.verificado).toBe(false);
      const certo = await h.telefoneVerificar(req("POST", "/telefone/verificar", bearer(cpl, tel), { codigo: v.code }), semParams);
      expect((await lerJson(certo)).dados.verificado).toBe(true);
    });
  });

  /* ------------------------------------------------------------ confirmar dose pela conversa */
  describe("conversa em código: confirmar dose", () => {
    it("'tomei' confirma e baixa o estoque; a MESMA mensagem duas vezes baixa uma vez só", async () => {
      const f = await novaFamilia("Tomei");
      const antes = await saldo(f);
      const messageId = `wa-${randomUUID()}`;
      const entrada = { telefone: f.adminPhone!, messageId, texto: "tomei", now: T0610 };
      const r1 = await conversa(entrada);
      expect(r1.intent).toBe("dose_tomada");
      expect(r1.respostas[0]!.texto).toContain("Anotado");
      const r2 = await conversa(entrada);
      expect(r2.intent).toBe("repetida");
      expect(await movimentosDeDose(f.doses[0]!)).toBe(1);
      expect(await saldo(f)).toBe(antes - 1);
      const [d] = await admin`select status, channel, source_message_id from dose_events where id = ${f.doses[0]!}`;
      expect(d!["status"]).toBe("taken");
      expect(d!["channel"]).toBe("whatsapp");
      // outra mensagem para a mesma dose: já anotada, nada descontado de novo
      const r3 = await conversa({ ...entrada, messageId: `wa-${randomUUID()}`, texto: "tomei" });
      expect(r3.respostas[0]!.texto).toMatch(/Nenhuma dose pendente|Já estava anotado/);
      expect(await saldo(f)).toBe(antes - 1);
    });

    it("pela API: mesma Idempotency-Key/messageId devolve a resposta guardada e desconta uma vez", async () => {
      const f = await novaFamilia("Idem");
      const hoje = localParts(new Date(), TZ).date;
      await meds.saveScheme(f.admin, f.medId, { startDate: hoje, firstTime: (() => { const m = Math.max(0, localParts(new Date(Date.now() - 10 * 60_000), TZ).minutes); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; })(), phases: [{ everyHours: 24, fromDay: 1, toDay: null, perDose: 1 }] });
      await withFamilia(f.familyId, (tx) => tx.delete(s.doseEvents));
      await ensureDosesForDay(f.familyId, hoje);
      const antes = await saldo(f);
      const corpo = { messageId: `wa-${randomUUID()}`, texto: "tomei" };
      const a = await h.conversaMensagem(req("POST", "/conversa/mensagem", bearer(cpl, f.adminPhone!), corpo), semParams);
      const b = await h.conversaMensagem(req("POST", "/conversa/mensagem", bearer(cpl, f.adminPhone!), corpo), semParams);
      const ja = await lerJson(a);
      expect(ja.dados.intent).toBe("dose_tomada");
      expect(b.headers.get("Idempotent-Replay")).toBe("true");
      expect(await lerJson(b)).toEqual(ja);
      expect(await saldo(f)).toBe(antes - 1);
      const [c] = await admin`select count(*)::int as n from stock_movements where type = 'dose' and family_id = ${f.familyId}`;
      expect(c!["n"]).toBe(1);
    });

    it("duas doses abertas: responde com lista numerada e NUNCA adivinha; só a escolha confirma", async () => {
      const f = await novaFamilia("Amb");
      const tel = f.adminPhone!;
      const r = await conversa({ telefone: tel, messageId: `a-${randomUUID()}`, texto: "tomei", now: T1410 });
      expect(r.respostas[0]!.texto).toContain("Qual dose você tomou?");
      expect(r.respostas[0]!.opcoes).toHaveLength(2);
      expect(r.respostas[0]!.texto).toContain("*1* —");
      expect((await admin`select count(*)::int as n from dose_events where family_id = ${f.familyId} and status = 'taken'`)[0]!["n"]).toBe(0);
      expect(await saldo(f)).toBe(10);
      const r2 = await conversa({ telefone: tel, messageId: `a-${randomUUID()}`, texto: "2", now: T1410 });
      expect(r2.respostas[0]!.texto).toContain("Anotado");
      const taken = await admin`select id from dose_events where family_id = ${f.familyId} and status = 'taken'`;
      expect(taken.map((t) => t["id"])).toEqual([f.doses[1]]); // a 2ª da lista (14:00)
      expect(await saldo(f)).toBe(9);
    });

    it("'1' sem nenhuma pergunta recente não é adivinhado", async () => {
      const f = await novaFamilia("Um");
      const r = await conversa({ telefone: f.adminPhone!, messageId: `u-${randomUUID()}`, texto: "1", now: T0610 });
      expect(r.respostas[0]!.texto).toContain("Como posso ajudar");
      expect(await saldo(f)).toBe(10);
    });

    it("'2' (lembrar de novo) registra o pedido e não baixa estoque; a fila gera o novo lembrete depois", async () => {
      const f = await novaFamilia("Soneca");
      await conversa({ telefone: f.adminPhone!, messageId: `s-${randomUUID()}`, texto: "lembrar de novo", now: T0610 });
      const [d] = await admin`select remind_again_at, status from dose_events where id = ${f.doses[0]!}`;
      expect((d!["remind_again_at"] as Date).toISOString()).toBe("2026-10-19T09:25:00.000Z");
      expect(await saldo(f)).toBe(10);
      expect(await gerarMensagens(f.familyId, T0610)).toBeGreaterThan(0); // lembrete normal da dose das 06:00
      const antes = (await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId}`)[0]!["n"] as number;
      await gerarMensagens(f.familyId, new Date("2026-10-19T09:26:00Z"));
      const depois = (await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId}`)[0]!["n"] as number;
      expect(depois).toBeGreaterThan(antes);
      const [d2] = await admin`select remind_again_at from dose_events where id = ${f.doses[0]!}`;
      expect(d2!["remind_again_at"]).toBeNull();
    });

    it("'estoque' e 'próximas doses' respondem com o nome do paciente; sem permissão, é recusado", async () => {
      const f = await novaFamilia("Cons");
      const est = await conversa({ telefone: f.adminPhone!, messageId: `e-${randomUUID()}`, texto: "estoque", now: T0610 });
      expect(est.respostas[0]!.texto).toContain("Adelino");
      expect(est.respostas[0]!.texto).toContain("Zypred");
      const prox = await conversa({ telefone: f.adminPhone!, messageId: `p-${randomUUID()}`, texto: "próximas doses", now: T0610 });
      expect(prox.respostas[0]!.texto).toContain("06:00");
      // perfil sem whatsapp.query nem stock.view
      const p = await pessoa(f.familyId, "Confirmador", "Só check");
      await withFamilia(f.familyId, (tx) => tx.update(s.profiles).set({ permissions: { "doses.confirm": true } }).where(eq(s.profiles.name, "Confirmador")));
      const negado = await conversa({ telefone: p.phone!, messageId: `n-${randomUUID()}`, texto: "estoque", now: T0610 });
      expect(negado.intent).toBe("sem_permissao");
    });

    it("texto livre que não casa devolve intent 'livre' e nenhuma resposta (o agente de IA é do Lote 4B)", async () => {
      const f = await novaFamilia("Livre");
      const r = await lerJson(await msg(f.adminPhone!, "qual a melhor dieta para diabetes?"));
      expect(r.dados.intent).toBe("livre");
      expect(r.dados.respostas).toEqual([]);
    });
  });

  /* ------------------------------------------------------------ estados de acesso */
  describe("whatsapp_verified x active", () => {
    it("whatsapp_verified dá o check, vê estoque e próximas doses, mas não assume reposição nem vê receitas", async () => {
      const f = await novaFamilia("Estados");
      const p = await pessoa(f.familyId, "Administrador", "Convidada", { state: "whatsapp_verified" });
      const a = await resolveSender(p.phone!);
      expect(a?.access).toBe("whatsapp_verified");
      expect(a?.member.permissions["prescriptions.view"]).toBeUndefined();
      expect(a?.member.permissions["members.manage"]).toBeUndefined();
      expect(a?.member.profileName).not.toBe("Administrador"); // o nome "Administrador" liberaria tudo em can()
      const ok = await conversa({ telefone: p.phone!, messageId: `v-${randomUUID()}`, texto: "tomei", now: T0610 });
      expect(ok.respostas[0]!.texto).toContain("Anotado");
      expect((await conversa({ telefone: p.phone!, messageId: `v-${randomUUID()}`, texto: "estoque", now: T0610 })).respostas[0]!.texto).toContain("Estoque");
      const cuido = await conversa({ telefone: p.phone!, messageId: `v-${randomUUID()}`, texto: "eu cuido disso", now: T0610 });
      expect(cuido.respostas[0]!.texto).toContain("Só pelo portal");
      // pela API: receitas exigem acesso completo
      const rec = await h.receitasListar(req("GET", "/receitas", bearer(cpl, p.phone!)), semParams);
      expect(rec.status).toBe(403);
      expect((await lerJson(rec)).erro?.codigo).toBe("sem_permissao");
      // e quem é active com o perfil certo, vê
      const ativo = await h.receitasListar(req("GET", "/receitas", bearer(cpl, f.adminPhone!)), semParams);
      expect(ativo.status).toBe(200);
    });

    it("'link de acesso' só para quem ainda não terminou o primeiro acesso; o link anterior deixa de valer", async () => {
      const f = await novaFamilia("Link");
      const p = await pessoa(f.familyId, "Familiar", "Esperando", { state: "whatsapp_verified" });
      const r1 = await conversa({ telefone: p.phone!, messageId: `l-${randomUUID()}`, texto: "me manda o link de acesso", now: T0610 });
      const url1 = /(https?:\/\/\S+primeiro-acesso\?t=\S+)/.exec(r1.respostas[0]!.texto)![1]!;
      const r2 = await conversa({ telefone: p.phone!, messageId: `l-${randomUUID()}`, texto: "link de acesso", now: T0610 });
      const url2 = /(https?:\/\/\S+primeiro-acesso\?t=\S+)/.exec(r2.respostas[0]!.texto)![1]!;
      expect(url1).not.toBe(url2);
      expect(await resolverLinkPrimeiroAcesso(sha256(url1.split("t=")[1]!))).toBeNull();
      expect((await resolverLinkPrimeiroAcesso(sha256(url2.split("t=")[1]!)))?.membroId).toBe(p.id);
      const ativo = await conversa({ telefone: f.adminPhone!, messageId: `l-${randomUUID()}`, texto: "link de acesso", now: T0610 });
      expect(ativo.respostas[0]!.texto).toContain("Acesso completo");
    });
  });

  /* ------------------------------------------------------------ convite por WhatsApp */
  describe("convite por WhatsApp", () => {
    async function convite(f: Fam, esperado: string) {
      const code = gerarCodigoVerificacao();
      const memberId = await withFamilia(f.familyId, async (tx) => {
        const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, "Familiar"));
        const [m] = await tx.insert(s.members).values({ familyId: f.familyId, profileId: p!.id, name: "Rosa Convidada" }).returning({ id: s.members.id });
        await tx.insert(s.invites).values({
          familyId: f.familyId, kind: "whatsapp", profileId: p!.id, memberId: m!.id, expectedPhone: esperado,
          codeHash: hashConviteCodigo(esperado, code), expiresAt: new Date(Date.now() + VALIDADE_CONVITE_MS), createdByMemberId: f.adminId,
        });
        return m!.id;
      });
      return { code, memberId };
    }

    it("outro número com o código certo não entra; o número esperado entra uma vez e recebe o link de primeiro acesso", async () => {
      const f = await novaFamilia("Conv");
      const esperado = telefoneAleatorio();
      const { code, memberId } = await convite(f, esperado);
      const intruso = await lerJson(await msg(telefoneAleatorio(), code));
      expect(intruso.dados.intent).toBe("codigo_invalido");
      expect((await admin`select access_state from members where id = ${memberId}`)[0]!["access_state"]).toBe("invited");

      const ok = await lerJson(await msg(esperado, `CÓDIGO ${code}`));
      expect(ok.dados.intent).toBe("convite_aceito");
      const texto = ok.dados.respostas[0].texto as string;
      const token = /primeiro-acesso\?t=([\w-]+)/.exec(texto)![1]!;
      const [m] = await admin`select access_state, phone_verified from members where id = ${memberId}`;
      expect(m!["access_state"]).toBe("whatsapp_verified");
      expect(m!["phone_verified"]).toBe(esperado);
      const link = await resolverLinkPrimeiroAcesso(sha256(token));
      expect(link?.membroId).toBe(memberId);
      expect(link?.estadoAcesso).toBe("whatsapp_verified");
      expect(link!.expiraEm.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);

      // uso único: o mesmo código de novo não vale
      const de_novo = await lerJson(await msg(esperado, code));
      expect(de_novo.dados.intent).toBe("codigo"); // já é membro: o código não é aceito de novo
      // já é membro com acesso básico: dá o check
      const check = await conversa({ telefone: esperado, messageId: `c-${randomUUID()}`, texto: "tomei", now: T0610 });
      expect(check.respostas[0]!.texto).toContain("Anotado");
    });

    it("convite vencido não vale", async () => {
      const f = await novaFamilia("ConvVenc");
      const esperado = telefoneAleatorio();
      const { code, memberId } = await convite(f, esperado);
      await admin`update invites set created_at = now() - interval '2 days', expires_at = now() - interval '1 minute' where member_id = ${memberId}`;
      const r = await lerJson(await msg(esperado, code));
      expect(r.dados.intent).toBe("codigo_invalido");
    });
  });

  /* ------------------------------------------------------------ API: chaves */
  describe("API /api/v1: chaves, escopo e família", () => {
    it("sem chave, chave inventada, prefixo errado e chave revogada = 401", async () => {
      const f = await novaFamilia("Chaves");
      const tel = f.adminPhone!;
      const sem = await h.dosesProximas(req("GET", "/doses/proximas", { "x-telefone": tel }), semParams);
      expect(sem.status).toBe(401);
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer("cdf_inventada", tel)), semParams)).status).toBe(401);
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer("xyz_inventada", tel)), semParams)).status).toBe(401);
      const k = await criarChaveFamilia(f.admin, "zz-test");
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer(k.chave, tel)), semParams)).status).toBe(200);
      await revogarChaveFamilia(f.admin, k.id);
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer(k.chave, tel)), semParams)).status).toBe(401);
      // a chave só existe como hash
      const [row] = await admin`select key_hash, prefix from api_keys where id = ${k.id}`;
      expect(row!["key_hash"]).toBe(sha256(k.chave));
      expect(JSON.stringify(row)).not.toContain(k.chave);
      const lista = await listarChavesFamilia(f.admin);
      expect(JSON.stringify(lista)).not.toContain(k.chave);
    });

    it("chave da família A não enxerga telefone da família B (mesma resposta de telefone desconhecido); a de plataforma enxerga os dois", async () => {
      const a = await novaFamilia("ChA");
      const b = await novaFamilia("ChB");
      const ka = await criarChaveFamilia(a.admin, "zz-test");
      const daAnaB = await h.dosesProximas(req("GET", "/doses/proximas", bearer(ka.chave, b.adminPhone!)), semParams);
      expect(daAnaB.status).toBe(404);
      const desconhecido = await h.dosesProximas(req("GET", "/doses/proximas", bearer(ka.chave, telefoneAleatorio())), semParams);
      expect(desconhecido.status).toBe(404);
      expect((await lerJson(daAnaB)).erro).toEqual((await lerJson(desconhecido)).erro);
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer(ka.chave, a.adminPhone!)), semParams)).status).toBe(200);
      for (const tel of [a.adminPhone!, b.adminPhone!]) expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer(cpl, tel)), semParams)).status).toBe(200);
    });

    it("telefone obrigatório, formato e rate limit por telefone", async () => {
      const f = await novaFamilia("Lim");
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer(cpl)), semParams)).status).toBe(400);
      expect((await h.dosesProximas(req("GET", "/doses/proximas", bearer(cpl, "123")), semParams)).status).toBe(400);
      let ultimo = 200;
      for (let i = 0; i < 62; i++) ultimo = (await h.dosesProximas(req("GET", "/doses/proximas", bearer(cpl, f.adminPhone!)), semParams)).status;
      expect(ultimo).toBe(429);
    });

    it("chave de família não usa a conversa nem a verificação (rotas só de plataforma)", async () => {
      const f = await novaFamilia("SoPlat");
      const k = await criarChaveFamilia(f.admin, "zz-test");
      const r = await msg(f.adminPhone!, "ajuda", k.chave);
      expect(r.status).toBe(403);
    });

    it("chave de plataforma sem o escopo 'conversa' é recusada", async () => {
      const f = await novaFamilia("Escopo");
      const k = await criarChavePlataforma("zz-test sem escopo", ["outra"]);
      chavesPlataforma.push(k.id);
      const r = await h.dosesProximas(req("GET", "/doses/proximas", bearer(k.chave, f.adminPhone!)), semParams);
      expect(r.status).toBe(403);
    });

    it("simulador: o segredo interno só vale com SIMULATOR_ENABLED=1; sem ele a rota recusa", async () => {
      const f = await novaFamilia("Sim");
      const antes = process.env["SIMULATOR_ENABLED"];
      delete process.env["SIMULATOR_ENABLED"];
      const { simulatorSecret } = await import("../api/core");
      const r = await h.conversaMensagem(req("POST", "/conversa/mensagem", { "x-mc-simulador": simulatorSecret(), "x-telefone": f.adminPhone! }, { messageId: "x", texto: "ajuda" }), semParams);
      expect(r.status).toBe(401);
      process.env["SIMULATOR_ENABLED"] = "1";
      try {
        const ok = await h.conversaMensagem(req("POST", "/conversa/mensagem", { "x-mc-simulador": simulatorSecret(), "x-telefone": f.adminPhone! }, { messageId: `sim-${randomUUID()}`, texto: "ajuda" }), semParams);
        expect(ok.status).toBe(200);
        const errado = await h.conversaMensagem(req("POST", "/conversa/mensagem", { "x-mc-simulador": "palpite", "x-telefone": f.adminPhone! }, { messageId: "x", texto: "ajuda" }), semParams);
        expect(errado.status).toBe(401);
      } finally {
        if (antes === undefined) delete process.env["SIMULATOR_ENABLED"];
        else process.env["SIMULATOR_ENABLED"] = antes;
      }
    });

    it("confirmar pela API: Idempotency-Key repetida devolve o mesmo e desconta uma vez; corpo diferente com a mesma chave = 422", async () => {
      const f = await novaFamilia("ApiConf");
      const antes = await saldo(f);
      const k = `ik-${randomUUID()}`;
      const mk = () => req("POST", `/doses/${f.doses[0]!}/confirmar`, bearer(cpl, f.adminPhone!, { "idempotency-key": k }), {});
      const ctx = { params: Promise.resolve({ id: f.doses[0]! }) };
      const a = await h.dosesConfirmar(mk(), ctx);
      const b = await h.dosesConfirmar(mk(), ctx);
      expect(a.status).toBe(200);
      expect(b.headers.get("Idempotent-Replay")).toBe("true");
      expect(await saldo(f)).toBe(antes - 1);
      const outro = await h.dosesConfirmar(req("POST", `/doses/${f.doses[0]!}/confirmar`, bearer(cpl, f.adminPhone!, { "idempotency-key": k }), { messageId: "diferente" }), ctx);
      expect(outro.status).toBe(422);
      expect((await lerJson(outro)).erro?.codigo).toBe("idempotencia_conflito");
    });

    it("dose de outra família: 'Dose não encontrada' (RLS), sem vazar", async () => {
      const a = await novaFamilia("DosA");
      const b = await novaFamilia("DosB");
      const r = await h.dosesConfirmar(req("POST", `/doses/${b.doses[0]!}/confirmar`, bearer(cpl, a.adminPhone!), {}), { params: Promise.resolve({ id: b.doses[0]! }) });
      expect(r.status).toBe(422);
      expect(await movimentosDeDose(b.doses[0]!)).toBe(0);
    });

    it("erros no formato { erro: { codigo, mensagem } } e auditoria da plataforma sem telefone completo", async () => {
      const f = await novaFamilia("Aud");
      const r = await h.dosesProximas(req("GET", "/doses/proximas", bearer(cpl, f.adminPhone!)), semParams);
      expect(r.status).toBe(200);
      const [a] = await admin`select masked_phone, route, status from platform_audit_log order by at desc limit 1`;
      expect(a!["masked_phone"]).toBe(`…${f.adminPhone!.slice(-4)}`);
      expect(a!["masked_phone"]).not.toContain(f.adminPhone!);
      const e = await lerJson(await h.dosesProximas(req("GET", "/doses/proximas", bearer("cdf_x", f.adminPhone!)), semParams));
      expect(Object.keys(e)).toEqual(["erro"]);
      expect(e.erro).toMatchObject({ codigo: "nao_autorizado" });
    });
  });

  /* ------------------------------------------------------------ fila de saída */
  describe("mensagens prontas e fila de saída", () => {
    it("lembrete de dose só para número VERIFICADO; quem não verificou não gera linha", async () => {
      const f = await novaFamilia("Fila");
      const ver = await pessoa(f.familyId, "Familiar", "Ana");
      await pessoa(f.familyId, "Familiar", "Pendente", { phone: null, pending: telefoneAleatorio() });
      await pessoa(f.familyId, "Familiar", "Sem número", { phone: null });
      const lista = await pendentes(f.familyId, { reivindicar: false, agora: T0610 });
      const doses = lista.filter((m) => m.tipo === "dose_reminder");
      expect(new Set(doses.map((m) => m.telefone))).toEqual(new Set([f.adminPhone!, ver.phone!]));
      const m = doses[0]!;
      expect(m.texto).toContain("Adelino");
      expect(m.texto).toContain("Zypred");
      expect(m.texto).toContain("*1* — Tomei");
      expect(m.texto).toContain("*2* — Lembrar em 15 min");
      expect(m.opcoes.map((o) => o.rotulo)).toEqual(["Tomei", "Lembrar em 15 min"]);
      const [c] = await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId} and member_id in (select id from members where phone_verified is null)`;
      expect(c!["n"]).toBe(0);
    });

    it("com SUPPORTS_BUTTONS=true o texto vai sem as linhas numeradas", async () => {
      const f = await novaFamilia("Botoes");
      process.env["SUPPORTS_BUTTONS"] = "true";
      try {
        const lista = await pendentes(f.familyId, { reivindicar: false, agora: T0610 });
        expect(lista[0]!.texto).not.toContain("*1* —");
        expect(lista[0]!.opcoes).toHaveLength(2);
      } finally {
        delete process.env["SUPPORTS_BUTTONS"];
      }
    });

    it("gerar de novo não duplica; reivindicar dá lease; marcar enviada é idempotente", async () => {
      const f = await novaFamilia("Idm");
      const a = await pendentes(f.familyId, { reivindicar: true, agora: T0610 });
      expect(a.length).toBeGreaterThan(0);
      const logo = await pendentes(f.familyId, { reivindicar: true, agora: new Date(T0610.getTime() + 30_000) });
      expect(logo).toHaveLength(0); // lease de 2 min
      expect(await gerarMensagens(f.familyId, T0610)).toBe(0);
      const id = a[0]!.id.split(".")[1]!;
      expect(await marcarEnviada(f.familyId, id)).toEqual({ ok: true, jaEnviada: false });
      expect(await marcarEnviada(f.familyId, id)).toEqual({ ok: true, jaEnviada: true });
      const depoisDoLease = await pendentes(f.familyId, { reivindicar: true, agora: new Date(T0610.getTime() + 5 * 60_000) });
      expect(depoisDoLease.map((m) => m.id)).not.toContain(a[0]!.id);
      expect(await marcarEnviada(f.familyId, randomUUID())).toEqual({ ok: false, motivo: "nao_encontrada" });
    });

    it("falha no envio solta o lease e a mensagem volta", async () => {
      const f = await novaFamilia("Falha");
      const a = await pendentes(f.familyId, { reivindicar: true, agora: T0610 });
      await marcarEnviada(f.familyId, a[0]!.id.split(".")[1]!, { falhou: true });
      const de_novo = await pendentes(f.familyId, { reivindicar: true, agora: new Date(T0610.getTime() + 10_000) });
      expect(de_novo.map((m) => m.id)).toContain(a[0]!.id);
    });

    it("duas reivindicações ao mesmo tempo: cada mensagem sai uma só vez", async () => {
      const f = await novaFamilia("Conc");
      await gerarMensagens(f.familyId, T0610);
      const [x, y, z] = await Promise.all([1, 2, 3].map(() => pendentes(f.familyId, { reivindicar: true, agora: T0610 })));
      const todos = [...x!, ...y!, ...z!].map((m) => m.id);
      expect(todos.length).toBeGreaterThan(0);
      expect(new Set(todos).size).toBe(todos.length);
    });

    it("dose já confirmada no portal sai da fila (lembrete obsoleto é descartado)", async () => {
      const f = await novaFamilia("Obs");
      await gerarMensagens(f.familyId, T0610);
      await admin`update dose_events set status = 'taken' where id = ${f.doses[0]!}`;
      const lista = await pendentes(f.familyId, { reivindicar: true, agora: T0610 });
      expect(lista.filter((m) => m.tipo === "dose_reminder")).toHaveLength(0);
      const [c] = await admin`select count(*)::int as n from outbound_messages where family_id = ${f.familyId} and discarded_at is not null`;
      expect(c!["n"]).toBeGreaterThan(0);
    });

    it("pessoa que perde o número verificado deixa de receber o que já estava na fila", async () => {
      const f = await novaFamilia("Perde");
      const ana = await pessoa(f.familyId, "Familiar", "Ana");
      await gerarMensagens(f.familyId, T0610);
      await admin`update members set phone_verified = null, access_state = 'active' where id = ${ana.id}`;
      const lista = await pendentes(f.familyId, { reivindicar: false, agora: T0610 });
      expect(lista.map((m) => m.telefone)).not.toContain(ana.phone);
    });

    it("dose esquecida avisa a família; estoque baixo vai a quem pode comprar (com 'Eu cuido disso') e o resumo sai no horário", async () => {
      const f = await novaFamilia("Avisos");
      const fam = await pessoa(f.familyId, "Familiar", "Ana");
      const cuida = await pessoa(f.familyId, "Cuidadora", "Cida");
      // dose das 06:00 esquecida (8:00 em diante) e estoque no limite
      await adjustStock(f.admin, f.medId, 2, "teste de estoque baixo", new Date("2026-10-19T14:00:00Z"));
      const t = new Date("2026-10-19T14:30:00Z"); // 11:30 locais
      await gerarMensagens(f.familyId, t);
      const lista = await pendentes(f.familyId, { reivindicar: false, agora: t });
      const por = (tipo: string) => lista.filter((m) => m.tipo === tipo);
      expect(por("dose_missed").length).toBeGreaterThan(0);
      expect(por("dose_missed")[0]!.texto).toContain("Dose esquecida");
      const baixo = por("low_stock");
      const dest = new Set(baixo.map((m) => m.telefone));
      expect(dest.has(f.adminPhone!)).toBe(true);
      expect(dest.has(fam.phone!)).toBe(true); // Familiar tem stock.adjust e replenishment.manage
      expect(dest.has(cuida.phone!)).toBe(false); // Cuidadora não compra
      expect(baixo[0]!.texto).toContain("Estoque baixo");
      expect(baixo[0]!.texto).toContain("*1* — Eu cuido disso");
      // resumo diário só depois das 20:00 locais
      expect(por("daily_summary")).toHaveLength(0);
      const noite = new Date("2026-10-19T23:30:00Z"); // 20:30
      await gerarMensagens(f.familyId, noite);
      const resumo = (await pendentes(f.familyId, { reivindicar: false, agora: noite })).filter((m) => m.tipo === "daily_summary");
      expect(resumo.length).toBeGreaterThan(0);
      expect(resumo[0]!.texto).toContain("Resumo do dia");
      expect(resumo[0]!.texto).toContain("19/10/2026");
    });

    it("'eu cuido disso' depois do aviso de estoque baixo assume a reposição (acesso completo)", async () => {
      const f = await novaFamilia("Cuido");
      await adjustStock(f.admin, f.medId, 2, "estoque baixo", new Date("2026-10-19T14:00:00Z"));
      const t = new Date("2026-10-19T14:30:00Z");
      const msgs = await pendentes(f.familyId, { reivindicar: true, agora: t });
      expect(msgs.some((m) => m.tipo === "low_stock")).toBe(true);
      const r = await conversa({ telefone: f.adminPhone!, messageId: `c-${randomUUID()}`, texto: "1", now: t });
      expect(r.respostas[0]!.texto).toContain("Reposição assumida");
      const [rep] = await admin`select owner_member_id from replenishment_steps st join replenishments r on r.id = st.replenishment_id where r.family_id = ${f.familyId} and st.owner_member_id is not null`;
      expect(rep!["owner_member_id"]).toBe(f.adminId);
    });

    it("rotas da fila: chave de família só enxerga a própria família; plataforma enxerga todas; marcar enviada de outra família = 404", async () => {
      const a = await novaFamilia("RotaA");
      const b = await novaFamilia("RotaB");
      const ka = await criarChaveFamilia(a.admin, "zz-test");
      // as rotas usam o relógio real: força uma mensagem vencida em cada família
      for (const f of [a, b]) {
        await withFamilia(f.familyId, (tx) =>
          tx.insert(s.outboundMessages).values({ familyId: f.familyId, memberId: f.adminId, kind: "dose_reminder", dedupeKey: `t:${randomUUID()}`, body: "teste", options: [], context: {}, notBefore: new Date(Date.now() - 1000) }));
      }
      const daFamilia = await lerJson(await h.lembretesPendentes(req("GET", "/lembretes/pendentes?somenteLer=1", bearer(ka.chave)), semParams));
      expect(daFamilia.dados.mensagens.every((m: { familiaId: string }) => m.familiaId === a.familyId)).toBe(true);
      expect(daFamilia.dados.mensagens.length).toBeGreaterThan(0);
      const todas = await lerJson(await h.lembretesPendentes(req("GET", "/lembretes/pendentes?somenteLer=1", bearer(cpl)), semParams));
      const fams = new Set(todas.dados.mensagens.map((m: { familiaId: string }) => m.familiaId));
      expect(fams.has(a.familyId) && fams.has(b.familyId)).toBe(true);

      const deB = todas.dados.mensagens.find((m: { familiaId: string }) => m.familiaId === b.familyId);
      const cruzada = await h.lembreteEnviado(req("POST", `/lembretes/${deB.id}/enviado`, bearer(ka.chave), {}), { params: Promise.resolve({ id: deB.id }) });
      expect(cruzada.status).toBe(404);
      const ok = await h.lembreteEnviado(req("POST", `/lembretes/${deB.id}/enviado`, bearer(cpl), {}), { params: Promise.resolve({ id: deB.id }) });
      expect(ok.status).toBe(200);
      const outra = await h.lembreteEnviado(req("POST", `/lembretes/${deB.id}/enviado`, bearer(cpl), {}), { params: Promise.resolve({ id: deB.id }) });
      expect((await lerJson(outra)).dados.jaEnviada).toBe(true);
    });
  });

  /* ------------------------------------------------------------ isolamento */
  describe("isolamento entre famílias nas tabelas novas", () => {
    it("contexto e fila de uma família não aparecem na outra", async () => {
      const a = await novaFamilia("IsoA");
      const b = await novaFamilia("IsoB");
      await pendentes(a.familyId, { reivindicar: true, agora: T0610 });
      await conversa({ telefone: a.adminPhone!, messageId: `i-${randomUUID()}`, texto: "tomei", now: T0610 });
      const veB = await withFamilia(b.familyId, async (tx) => ({ o: await tx.select().from(s.outboundMessages), c: await tx.select().from(s.conversationState) }));
      expect(veB.o.filter((x) => x.familyId === a.familyId)).toHaveLength(0);
      expect(veB.c.filter((x) => x.familyId === a.familyId)).toHaveLength(0);
      const actor = await loadWaActor(a.familyId, a.adminId, "active", a.adminPhone!);
      expect(actor?.familyId).toBe(a.familyId);
      // processar como membro de A sem passar pelo remetente: não toca dose de B
      const r = await processarMensagem(actor!, { telefone: a.adminPhone!, messageId: `z-${randomUUID()}`, texto: "estoque", now: T0610 });
      expect(r.respostas[0]!.texto).not.toContain("IsoB");
    });
  });
});
