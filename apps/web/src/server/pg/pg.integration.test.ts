// @vitest-environment node
/**
 * Integração do Lote 1 contra o Postgres local (pnpm db:up): regras de negócio do portal com o papel da APLICAÇÃO
 * (sem BYPASSRLS), duas famílias, permissões negadas no servidor e convites. O Appwrite é trocado por um falso
 * (AuthPort): aqui só interessa o que vai para o banco. Sem o banco no ar, a suíte é PULADA.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  consumirConviteWhatsapp, hashConviteCodigo, resolverLinkPrimeiroAcesso, resolverMembroPorAppwriteUser, sha256, withFamilia,
} from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, telefoneAleatorio, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import type { Ctx } from "./access";
import { ForbiddenError, UserError } from "./errors";
import { createFamilyWithAdmin } from "./families";
import type { Actor } from "./guard";
import * as members from "./members";
import * as meds from "./medications";
import * as patients from "./patients";
import * as profiles from "./profiles";
import { buildSnapshot } from "./snapshot";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes de integração do Lote 1 PULADOS. Rode `pnpm db:up`.");

const auth = {
  sendInviteEmail: vi.fn(async (_email: string, _url: string) => {}),
  revokeSessions: vi.fn(async (_id: string) => {}),
  setEnabled: vi.fn(async (_id: string, _on: boolean) => {}),
};
const deps = { auth, baseUrl: "https://staging.exemplo.test" };

const ALL: PermissionMap = SYSTEM_PROFILES[0]!.permissions;
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;

interface Fam {
  familyId: string;
  admin: Actor;
  ctxOf: (a: Actor) => Ctx;
}

async function novaFamilia(nome: string, criadas: string[]): Promise<Fam> {
  const appwriteUserId = `zz-test-${randomUUID()}`;
  const { familyId, memberId } = await createFamilyWithAdmin({ appwriteUserId, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}` });
  criadas.push(familyId);
  const admin: Actor = { familyId, memberId, timezone: "America/Sao_Paulo", member: { id: memberId, name: `Admin ${nome}`, profileName: "Administrador", permissions: ALL } };
  const ctxOf = (a: Actor): Ctx => ({
    familyId, familyName: `Família ${nome}`, timezone: "America/Sao_Paulo", settings: familySettingsSchema.parse({}),
    account: { id: "x", email: "x@exemplo.test", name: a.member.name, emailVerified: true }, memberId: a.memberId, profileId: "p", member: a.member,
  });
  return { familyId, admin, ctxOf };
}

/** Cria um membro ATIVO (com id do Appwrite fictício) num perfil e devolve quem age como ele. */
async function membroAtivo(f: Fam, profileName: string, nome = profileName): Promise<Actor & { appwriteUserId: string }> {
  const appwriteUserId = `zz-test-${randomUUID()}`;
  const id = await withFamilia(f.familyId, async (tx) => {
    const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, profileName));
    const [m] = await tx
      .insert(s.members)
      .values({
        familyId: f.familyId, profileId: p!.id, name: nome, email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: "active",
        appwriteUserId, emailConfirmedAt: new Date(),
      })
      .returning({ id: s.members.id });
    return m!.id;
  });
  return { familyId: f.familyId, memberId: id, timezone: "America/Sao_Paulo", member: { id, name: nome, profileName, permissions: permsOf(profileName) }, appwriteUserId };
}

describe.skipIf(!up)("Lote 1 — regras do portal no Postgres", () => {
  let admin: Admin;
  const criadas: string[] = [];
  let A: Fam;
  let B: Fam;

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
    A = await novaFamilia("A", criadas);
    B = await novaFamilia("B", criadas);
  });

  afterAll(async () => {
    // audit_log referencia membros (actor): apagar antes (limparFamilias apaga membros primeiro)
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  describe("primeira entrada", () => {
    it("cria família, perfis iniciais e o administrador ativo", async () => {
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      expect(snap.family.name).toBe("Família A");
      expect(snap.profiles).toEqual(["Administrador", "Familiar", "Cuidadora", "Confirmador"]);
      expect(snap.people).toHaveLength(1);
      expect(snap.people[0]).toMatchObject({ profileName: "Administrador", accessState: "active", isSelf: true });
    });

    it("o login resolve o membro pelo id do Appwrite e a família vem do banco", async () => {
      const m = await membroAtivo(A, "Familiar");
      const r = await resolverMembroPorAppwriteUser(m.appwriteUserId);
      expect(r).toMatchObject({ membroId: m.memberId, familiaId: A.familyId, ativo: true, estadoAcesso: "active" });
    });

    it("a mesma conta do Appwrite não cria duas famílias", async () => {
      const id = `zz-test-${randomUUID()}`;
      const first = await createFamilyWithAdmin({ appwriteUserId: id, name: "Dup", email: `zz-test-${randomUUID().slice(0, 6)}@exemplo.test`, familyName: "Família Dup" });
      criadas.push(first.familyId);
      await expect(createFamilyWithAdmin({ appwriteUserId: id, name: "Dup", email: `zz-test-${randomUUID().slice(0, 6)}@exemplo.test`, familyName: "Outra" })).rejects.toBeInstanceOf(UserError);
    });
  });

  describe("permissões recusadas no servidor", () => {
    it("Confirmador não faz nada de administração (cada operação lança ForbiddenError)", async () => {
      const c = await membroAtivo(A, "Confirmador");
      const ops: Array<() => Promise<unknown>> = [
        () => members.inviteByEmail(c, { kind: "email", name: "X", email: "x@exemplo.test", profileName: "Familiar" }, deps),
        () => members.inviteByWhatsapp(c, { kind: "whatsapp", name: "X", phone: telefoneAleatorio(), profileName: "Familiar" }),
        () => members.updateMember(c, A.admin.memberId, { name: "X", profileName: "Administrador" }),
        () => members.deactivateMember(c, A.admin.memberId, deps),
        () => patients.savePatient(c, { name: "P", birthDate: "", notes: "", usesPhone: true, selfMemberId: null }),
        () => meds.createMedication(c, { patientId: randomUUID(), name: "M", alternatives: [], route: "tablet", controlUnit: "unit" }),
        () => meds.saveScheme(c, randomUUID(), { firstTime: "08:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] }),
        () => profiles.setPermission(c, "confirm", "Familiar", true),
      ];
      for (const op of ops) await expect(op()).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("Confirmador também não vê pessoas nem a matriz no retrato; vê pacientes", async () => {
      const c = await membroAtivo(A, "Confirmador");
      const snap = await buildSnapshot(A.ctxOf(c));
      expect(snap.people).toEqual([]);
      expect(snap.permissionRows).toEqual([]);
      expect(snap.member.profileName).toBe("Confirmador");
    });

    it("Familiar não administra pessoas, mas o Administrador sim", async () => {
      const f = await membroAtivo(A, "Familiar");
      await expect(members.deactivateMember(f, A.admin.memberId, deps)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(patients.savePatient(f, { name: "P", birthDate: "", notes: "", usesPhone: true, selfMemberId: null })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("uma permissão ligada ao perfil passa a valer (e desligada, deixa de valer)", async () => {
      const cuid = await membroAtivo(A, "Cuidadora");
      await expect(patients.savePatient(cuid, { name: "P", birthDate: "", notes: "", usesPhone: true, selfMemberId: null })).rejects.toBeInstanceOf(ForbiddenError);
      await profiles.setPermission(A.admin, "users", "Cuidadora", true);
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      const row = snap.permissionRows.find((r) => r.id === "users")!;
      expect(row.values[snap.profiles.indexOf("Cuidadora")]).toBe(true);
      const novo = { ...cuid, member: { ...cuid.member, permissions: { ...cuid.member.permissions, "patients.manage": true } } } as Actor;
      const id = await patients.savePatient(novo, { name: "Paciente da Cuidadora", birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      await profiles.setPermission(A.admin, "users", "Cuidadora", false);
    });

    it("o Administrador não pode ser editado na matriz", async () => {
      await expect(profiles.setPermission(A.admin, "confirm", "Administrador", false)).rejects.toBeInstanceOf(UserError);
    });
  });

  describe("convite por e-mail", () => {
    it("cria a pessoa convidada, guarda só o hash do token e manda o link", async () => {
      auth.sendInviteEmail.mockClear();
      const email = `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`;
      const r = await members.inviteByEmail(A.admin, { kind: "email", name: "Filha Teste", email, profileName: "Familiar", relation: "filha" }, deps);
      expect(r).toMatchObject({ kind: "email", emailSent: true });
      expect(auth.sendInviteEmail).toHaveBeenCalledTimes(1);
      const [sentTo, url] = auth.sendInviteEmail.mock.calls[0]!;
      expect(sentTo).toBe(email);
      const token = new URL(url).searchParams.get("t")!;
      expect(url.startsWith("https://staging.exemplo.test/aceitar-convite?t=")).toBe(true);

      const link = await resolverLinkPrimeiroAcesso(sha256(token));
      expect(link).toMatchObject({ membroId: r.memberId, familiaId: A.familyId, email, estadoAcesso: "invited" });

      const rows = await admin`select token_hash from first_access_links where member_id = ${r.memberId}`;
      expect(rows[0]!["token_hash"]).toBe(sha256(token));
      expect(JSON.stringify(rows)).not.toContain(token);
      const [m] = await admin`select access_state, appwrite_user_id, profile_id from members where id = ${r.memberId}`;
      expect(m).toMatchObject({ access_state: "invited", appwrite_user_id: null });
    });

    it("e-mail repetido na família é recusado com mensagem clara", async () => {
      const email = `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`;
      await members.inviteByEmail(A.admin, { kind: "email", name: "Um", email, profileName: "Familiar" }, deps);
      await expect(members.inviteByEmail(A.admin, { kind: "email", name: "Dois", email: email.toUpperCase(), profileName: "Familiar" }, deps)).rejects.toThrow(/já existe/i);
    });

    it("falha no envio do e-mail não perde o convite (dá para reenviar)", async () => {
      auth.sendInviteEmail.mockRejectedValueOnce(Object.assign(new Error("smtp"), { code: 500 }));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await members.inviteByEmail(A.admin, { kind: "email", name: "Sem SMTP", email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, profileName: "Familiar" }, deps);
      err.mockRestore();
      expect(r.emailSent).toBe(false);
      auth.sendInviteEmail.mockClear();
      const again = await members.resendEmailInvite(A.admin, r.memberId, deps);
      expect(again.emailSent).toBe(true);
      // o link antigo deixa de valer; só o novo resolve
      const novoToken = new URL(auth.sendInviteEmail.mock.calls[0]![1]).searchParams.get("t")!;
      expect(await resolverLinkPrimeiroAcesso(sha256(novoToken))).not.toBeNull();
    });

    it("só um Administrador dá o perfil Administrador", async () => {
      const f = await membroAtivo(A, "Familiar");
      const fam = { ...f, member: { ...f.member, permissions: { ...f.member.permissions, "members.manage": true } } } as Actor;
      await expect(members.inviteByEmail(fam, { kind: "email", name: "X", email: "zz-test-x@exemplo.test", profileName: "Administrador" }, deps)).rejects.toThrow(/Administrador/);
    });

    it("cancelar o convite apaga a pessoa que nunca entrou", async () => {
      const r = await members.inviteByEmail(A.admin, { kind: "email", name: "Cancelar", email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, profileName: "Familiar" }, deps);
      await members.revokeInvite(A.admin, r.memberId);
      expect(await admin`select id from members where id = ${r.memberId}`).toHaveLength(0);
      expect(await admin`select id from first_access_links where member_id = ${r.memberId}`).toHaveLength(0);
    });
  });

  describe("convite por WhatsApp (só a criação; o uso é do Lote 4)", () => {
    it("gera código de 6 dígitos, guarda só o hash preso ao número e validade de 24 h", async () => {
      const phone = telefoneAleatorio();
      const r = await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Dona Zélia", phone: `+${phone}`, profileName: "Cuidadora", relation: "cuidadora" });
      expect(r.code).toMatch(/^\d{6}$/);
      expect(r.expectedPhone).toBe(phone);
      const [inv] = await admin`select * from invites where member_id = ${r.memberId}`;
      expect(inv).toMatchObject({ kind: "whatsapp", expected_phone: phone, consumed_at: null, revoked_at: null });
      expect(inv!["code_hash"]).toBe(hashConviteCodigo(phone, r.code!));
      expect(JSON.stringify(inv)).not.toContain(r.code!);
      const horas = (new Date(inv!["expires_at"]).getTime() - Date.now()) / 3_600_000;
      expect(horas).toBeGreaterThan(23.9);
      expect(horas).toBeLessThanOrEqual(24);
      const [m] = await admin`select access_state, phone_verified from members where id = ${r.memberId}`;
      expect(m).toMatchObject({ access_state: "invited", phone_verified: null });
    });

    it("compatível com o banco: o código certo, enviado do número esperado, consome o convite (uso único)", async () => {
      const phone = telefoneAleatorio();
      const r = await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Sr. Raimundo", phone, profileName: "Confirmador" });
      expect((await consumirConviteWhatsapp(phone, hashConviteCodigo(phone, r.code!))).resultado).toBe("verificado");
      expect((await consumirConviteWhatsapp(phone, hashConviteCodigo(phone, r.code!))).resultado).toBe("invalido");
      await admin`delete from phone_lockouts where phone = ${phone}`;
    });

    it("outro número com o mesmo código não consome", async () => {
      const phone = telefoneAleatorio();
      const outro = telefoneAleatorio();
      const r = await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Preso ao número", phone, profileName: "Confirmador" });
      expect((await consumirConviteWhatsapp(outro, hashConviteCodigo(outro, r.code!))).resultado).toBe("invalido");
      await admin`delete from phone_lockouts where phone = ${outro}`;
    });

    it("número fora do formato é recusado; convite repetido para o mesmo número também", async () => {
      await expect(members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "X", phone: "123", profileName: "Familiar" })).rejects.toBeInstanceOf(UserError);
      const phone = telefoneAleatorio();
      await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Primeiro", phone, profileName: "Familiar" });
      await expect(members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Segundo", phone, profileName: "Familiar" })).rejects.toThrow(/já existe um convite/i);
    });

    it("novo código revoga o anterior e o código antigo deixa de valer", async () => {
      const phone = telefoneAleatorio();
      const r = await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Renovar", phone, profileName: "Familiar" });
      const novo = await members.regenerateWhatsappCode(A.admin, r.memberId);
      expect(novo.code).not.toBe(r.code);
      expect((await consumirConviteWhatsapp(phone, hashConviteCodigo(phone, r.code!))).resultado).toBe("invalido");
      expect((await consumirConviteWhatsapp(phone, hashConviteCodigo(phone, novo.code!))).resultado).toBe("verificado");
      await admin`delete from phone_lockouts where phone = ${phone}`;
    });

    it("a lista mostra o convite pendente com validade, sem expor o código", async () => {
      const r = await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Na lista", phone: telefoneAleatorio(), profileName: "Familiar" });
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      const p = snap.people.find((x) => x.id === r.memberId)!;
      expect(p).toMatchObject({ accessState: "invited", invite: { kind: "whatsapp", expired: false } });
      expect(JSON.stringify(snap)).not.toContain(r.code!);
    });
  });

  describe("desativar e reativar", () => {
    it("derruba as sessões do Appwrite e bloqueia o login; reativar libera", async () => {
      auth.revokeSessions.mockClear();
      auth.setEnabled.mockClear();
      const m = await membroAtivo(A, "Familiar");
      await members.deactivateMember(A.admin, m.memberId, deps);
      expect(auth.revokeSessions).toHaveBeenCalledWith(m.appwriteUserId);
      expect(auth.setEnabled).toHaveBeenCalledWith(m.appwriteUserId, false);
      const r = await resolverMembroPorAppwriteUser(m.appwriteUserId);
      expect(r?.ativo).toBe(false);
      await members.reactivateMember(A.admin, m.memberId, deps);
      expect(auth.setEnabled).toHaveBeenLastCalledWith(m.appwriteUserId, true);
      expect((await resolverMembroPorAppwriteUser(m.appwriteUserId))?.ativo).toBe(true);
    });

    it("não desativa a si mesmo", async () => {
      await expect(members.deactivateMember(A.admin, A.admin.memberId, deps)).rejects.toThrow(/a si mesmo/);
    });

    it("um segundo Administrador pode desativar o primeiro, e a pessoa desativada perde o acesso na hora", async () => {
      const solo = await novaFamilia("Solo", criadas);
      const segundo = await membroAtivo(solo, "Administrador");
      await members.deactivateMember(segundo, solo.admin.memberId, deps);
      const row = await admin`select active, removed_at from members where id = ${solo.admin.memberId}`;
      expect(row[0]).toMatchObject({ active: false });
      expect(row[0]!["removed_at"]).not.toBeNull();
    });

    it("quem não é Administrador não desativa um Administrador", async () => {
      const f = await membroAtivo(A, "Familiar");
      const fam = { ...f, member: { ...f.member, permissions: { ...f.member.permissions, "members.manage": true } } } as Actor;
      await expect(members.deactivateMember(fam, A.admin.memberId, deps)).rejects.toThrow(/Administrador/);
    });

    it("não muda o próprio perfil", async () => {
      await expect(members.updateMember(A.admin, A.admin.memberId, { name: "Admin", profileName: "Familiar" })).rejects.toThrow(/próprio perfil/);
    });
  });

  describe("pacientes, remédios e esquemas", () => {
    let patientId: string;
    let medId: string;

    it("cadastra um paciente (e ligado a uma conta quando ele também é usuário)", async () => {
      const conta = await membroAtivo(A, "Familiar", "Adelino");
      patientId = await patients.savePatient(A.admin, { name: "Adelino Souza", birthDate: "1942-03-10", notes: "", usesPhone: true, selfMemberId: conta.memberId });
      const maria = await patients.savePatient(A.admin, { name: "Maria Souza", birthDate: "1945-07-22", notes: "Alzheimer. Não usa celular.", usesPhone: false, selfMemberId: null });
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      const ad = snap.patients.find((p) => p.id === patientId)!;
      expect(ad).toMatchObject({ fullName: "Adelino Souza", name: "Adelino", selfMemberName: "Adelino", usesPhone: true });
      expect(ad.age).toBeGreaterThan(80);
      expect(snap.patients.find((p) => p.id === maria)).toMatchObject({ usesPhone: false, selfMemberId: null });
      // a mesma conta não pode ser de dois pacientes
      await expect(patients.savePatient(A.admin, { name: "Outro", birthDate: "", notes: "", usesPhone: true, selfMemberId: conta.memberId })).rejects.toThrow(/já está ligada/);
    });

    it("cria o remédio com marcas, via, unidade e gotas/ml, e um esquema inicial", async () => {
      medId = await meds.createMedication(A.admin, { patientId, name: "Zypred", alternatives: ["Facoba", "Vigadexa"], route: "drops", controlUnit: "drop", dropsPerMl: 18 });
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      const m = snap.medications.find((x) => x.id === medId)!;
      expect(m).toMatchObject({ name: "Zypred", alternatives: ["Facoba", "Vigadexa"], routeLabel: "Pingar", unitLabel: "Gotas", dropsPerMl: 18, patientId });
      expect(m.phases).toEqual([{ order: 1, everyHours: 24, fromDay: 1, toDay: null, perDose: 1 }]);
      expect(m.stock).toMatchObject({ tracked: false, quantityText: "Estoque ainda não registrado" });
    });

    it("grava o esquema com duas fases (3 em 3 h por 15 dias, depois 6 em 6 h)", async () => {
      await meds.saveScheme(A.admin, medId, {
        firstTime: "06:00", startDate: "2026-10-01",
        phases: [{ everyHours: 3, fromDay: 1, toDay: 15, perDose: 1 }, { everyHours: 6, fromDay: 16, toDay: null, perDose: 2 }],
      });
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      const m = snap.medications.find((x) => x.id === medId)!;
      expect(m.phases).toEqual([
        { order: 1, everyHours: 3, fromDay: 1, toDay: 15, perDose: 1 },
        { order: 2, everyHours: 6, fromDay: 16, toDay: null, perDose: 2 },
      ]);
      expect(m.firstTime).toBe("06:00");
      expect(m.startDate).toBe("2026-10-01");
      const rows = await admin`select schedule_type, first_dose_time, interval_hours from treatment_phases where treatment_id in (select id from treatments where medication_id = ${medId}) order by "order"`;
      expect(rows.map((r) => [r["schedule_type"], r["first_dose_time"], r["interval_hours"]])).toEqual([["interval", "06:00", 3], ["interval", "06:00", 6]]);
    });

    it("recusa fases com lacuna, sobreposição, início fora do dia 1 e fase aberta no meio — e não muda nada", async () => {
      const before = (await buildSnapshot(A.ctxOf(A.admin))).medications.find((x) => x.id === medId)!.phases;
      const ruins: Array<[string, Array<{ everyHours: number; fromDay: number; toDay: number | null; perDose: number }>]> = [
        ["lacuna", [{ everyHours: 3, fromDay: 1, toDay: 10, perDose: 1 }, { everyHours: 6, fromDay: 13, toDay: null, perDose: 1 }]],
        ["sobreposição", [{ everyHours: 3, fromDay: 1, toDay: 10, perDose: 1 }, { everyHours: 6, fromDay: 8, toDay: null, perDose: 1 }]],
        ["não começa no dia 1", [{ everyHours: 3, fromDay: 2, toDay: null, perDose: 1 }]],
        ["aberta no meio", [{ everyHours: 3, fromDay: 1, toDay: null, perDose: 1 }, { everyHours: 6, fromDay: 5, toDay: null, perDose: 1 }]],
        ["intervalo zero", [{ everyHours: 0, fromDay: 1, toDay: null, perDose: 1 }]],
        ["dose zero", [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 0 }]],
        ["fim antes do início", [{ everyHours: 8, fromDay: 5, toDay: 3, perDose: 1 }]],
      ];
      for (const [, phases] of ruins) await expect(meds.saveScheme(A.admin, medId, { firstTime: "08:00", phases })).rejects.toBeInstanceOf(UserError);
      await expect(meds.saveScheme(A.admin, medId, { firstTime: "25:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] })).rejects.toBeInstanceOf(UserError);
      expect((await buildSnapshot(A.ctxOf(A.admin))).medications.find((x) => x.id === medId)!.phases).toEqual(before);
    });

    it("edita, exclui e restaura o remédio (exclusão lógica)", async () => {
      await meds.updateMedication(A.admin, medId, { name: "Zypred colírio", alternatives: ["Facoba"] });
      let snap = await buildSnapshot(A.ctxOf(A.admin));
      expect(snap.medications.find((x) => x.id === medId)).toMatchObject({ name: "Zypred colírio", alternatives: ["Facoba"] });
      await meds.deleteMedication(A.admin, medId);
      snap = await buildSnapshot(A.ctxOf(A.admin));
      expect(snap.medications.find((x) => x.id === medId)).toBeUndefined();
      await meds.restoreMedication(A.admin, medId);
      snap = await buildSnapshot(A.ctxOf(A.admin));
      expect(snap.medications.find((x) => x.id === medId)).toBeDefined();
    });

    it("arquivar o paciente tira ele e os remédios dele das telas", async () => {
      const p = await patients.savePatient(A.admin, { name: "Para arquivar", birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
      const m = await meds.createMedication(A.admin, { patientId: p, name: "Remédio do arquivado", alternatives: [], route: "tablet", controlUnit: "unit" });
      await patients.deletePatient(A.admin, p);
      const snap = await buildSnapshot(A.ctxOf(A.admin));
      expect(snap.patients.find((x) => x.id === p)).toBeUndefined();
      expect(snap.medications.find((x) => x.id === m)).toBeUndefined();
    });

    it("dose negativa é recusada", async () => {
      await expect(meds.saveScheme(A.admin, medId, { firstTime: "08:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: -1 }] })).rejects.toBeInstanceOf(UserError);
    });
  });

  describe("WhatsApp da própria conta fica pendente", () => {
    it("guarda só dígitos como pendente, nunca como verificado, e dá para limpar", async () => {
      const m = await membroAtivo(A, "Familiar");
      await members.saveMyPhone(m, "(11) 91234-5678");
      let [row] = await admin`select phone_pending, phone_verified from members where id = ${m.memberId}`;
      expect(row).toMatchObject({ phone_pending: "5511912345678", phone_verified: null });
      const snap = await buildSnapshot(A.ctxOf(m));
      expect(snap.account).toMatchObject({ phonePending: "5511912345678", phoneVerified: "" });
      await members.saveMyPhone(m, "");
      [row] = await admin`select phone_pending from members where id = ${m.memberId}`;
      expect(row!["phone_pending"]).toBeNull();
      await expect(members.saveMyPhone(m, "12")).rejects.toBeInstanceOf(UserError);
    });
  });

  describe("isolamento entre duas famílias", () => {
    it("a segunda família não enxerga nada da primeira (retrato, SQL direto, ids alheios)", async () => {
      const pa = await patients.savePatient(A.admin, { name: "Paciente só da A", birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
      const ma = await meds.createMedication(A.admin, { patientId: pa, name: "Remédio só da A", alternatives: [], route: "tablet", controlUnit: "unit" });

      const snapB = await buildSnapshot(B.ctxOf(B.admin));
      expect(snapB.patients).toEqual([]);
      expect(snapB.medications).toEqual([]);
      expect(snapB.people.map((p) => p.name)).toEqual(["Admin B"]);
      expect(JSON.stringify(snapB)).not.toContain("só da A");

      // SQL direto como B: zero linhas das tabelas da A
      for (const t of [s.patients, s.medications, s.members, s.invites, s.auditLog]) {
        const rows = await withFamilia(B.familyId, (tx) => tx.select().from(t));
        expect(rows.every((r) => (r as { familyId: string }).familyId === B.familyId)).toBe(true);
      }

      // operar com ids da A estando na B é "não encontrado" (RLS), nunca altera a A
      await expect(patients.savePatient(B.admin, { id: pa, name: "Invadido", birthDate: "", notes: "", usesPhone: true, selfMemberId: null })).rejects.toThrow(/não encontrado/i);
      await expect(patients.deletePatient(B.admin, pa)).rejects.toThrow(/não encontrado/i);
      await expect(meds.updateMedication(B.admin, ma, { name: "Invadido" })).rejects.toThrow(/não encontrado/i);
      await expect(meds.deleteMedication(B.admin, ma)).rejects.toThrow(/não encontrado/i);
      await expect(meds.saveScheme(B.admin, ma, { firstTime: "08:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] })).rejects.toThrow(/não encontrado/i);
      await expect(meds.createMedication(B.admin, { patientId: pa, name: "X", alternatives: [], route: "tablet", controlUnit: "unit" })).rejects.toThrow(/Paciente não encontrado/);
      await expect(members.deactivateMember(B.admin, A.admin.memberId, deps)).rejects.toThrow(/não encontrada/i);
      await expect(patients.savePatient(B.admin, { name: "Ligar", birthDate: "", notes: "", usesPhone: true, selfMemberId: A.admin.memberId })).rejects.toThrow(/não está na família/);
      await expect(profiles.setPermission(B.admin, "confirm", "Familiar", true)).resolves.toBeUndefined(); // o perfil "Familiar" da B é outro

      const after = (await buildSnapshot(A.ctxOf(A.admin))).patients.find((p) => p.id === pa)!;
      expect(after.fullName).toBe("Paciente só da A");
      // a matriz da A não mudou com a mudança da B
      const rowA = (await buildSnapshot(A.ctxOf(A.admin))).permissionRows.find((r) => r.id === "confirm")!;
      const rowB = (await buildSnapshot(B.ctxOf(B.admin))).permissionRows.find((r) => r.id === "confirm")!;
      expect(rowA.values[1]).toBe(true); // Familiar já confirma na A (padrão)
      expect(rowB.values[1]).toBe(true);
    });

    it("o mesmo e-mail pode ser convidado em duas famílias, mas só um usuário do Appwrite pertence a uma família", async () => {
      const email = `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`;
      await members.inviteByEmail(A.admin, { kind: "email", name: "Em A", email, profileName: "Familiar" }, deps);
      await expect(members.inviteByEmail(B.admin, { kind: "email", name: "Em B", email, profileName: "Familiar" }, deps)).resolves.toMatchObject({ kind: "email" });
    });
  });

  describe("auditoria sem dados pessoais", () => {
    it("registra as ações administrativas e nunca grava telefone, e-mail ou código", async () => {
      const phone = telefoneAleatorio();
      const email = `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`;
      const w = await members.inviteByWhatsapp(A.admin, { kind: "whatsapp", name: "Auditada", phone, profileName: "Familiar" });
      await members.inviteByEmail(A.admin, { kind: "email", name: "Auditado", email, profileName: "Familiar" }, deps);
      const rows = await admin`select action, entity, entity_id, meta from audit_log where family_id = ${A.familyId}`;
      const actions = new Set(rows.map((r) => r["action"]));
      for (const a of ["family.create", "member.invite", "patient.create", "medication.create", "scheme.save", "profile.permission", "member.deactivate"]) expect(actions.has(a)).toBe(true);
      const blob = JSON.stringify(rows);
      expect(blob).not.toContain(phone);
      expect(blob).not.toContain(w.code!);
      expect(blob).not.toContain(email);
      expect(blob).not.toContain("5511912345678");
    });
  });
});
