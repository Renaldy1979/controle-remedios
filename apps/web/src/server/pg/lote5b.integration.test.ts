// @vitest-environment node
/**
 * Lote 5B (docs/13): LGPD. Aceite da política, autorização do paciente, exportar, pedir/cancelar a exclusão da família e a
 * exclusão definitiva (rotina diária). Papel da APLICAÇÃO (sem BYPASSRLS). Sem o banco no ar a suíte é PULADA (REQUIRE_DB=1 falha).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import { PRIVACY_VERSION } from "@/lib/privacy";
import { createFamilyWithAdmin } from "./families";
import { ForbiddenError, UserError } from "./errors";
import { excluirFamiliasVencidas } from "./exclusao";
import * as patients from "./patients";
import { acceptPrivacy, cancelFamilyDeletion, exportFamilyData, requestFamilyDeletion } from "./privacy";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes do Lote 5B (LGPD) PULADOS. Rode `pnpm db:up`.");

const TZ = "America/Sao_Paulo";
const settings = familySettingsSchema.parse({});
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;

describe.skipIf(!up)("Lote 5B — LGPD: aceite, exportar e excluir a família", () => {
  let admin: Admin;
  const criadas: string[] = [];

  interface Fam {
    familyId: string;
    nome: string;
    adm: { familyId: string; memberId: string; timezone: string; settings: typeof settings; member: { id: string; name: string; profileName: string; permissions: PermissionMap } };
    familiar: Fam["adm"];
    patientId: string;
    appwriteUser: string;
  }

  async function novaFamilia(tag: string): Promise<Fam> {
    const nome = `Família ${tag} ${randomUUID().slice(0, 4)}`;
    const appwriteUser = `zz-test-${randomUUID()}`;
    const r = await createFamilyWithAdmin({ appwriteUserId: appwriteUser, name: `Admin ${tag}`, email: `zz-test-${tag}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: nome });
    criadas.push(r.familyId);
    const ator = (memberId: string, profileName: string) => ({ familyId: r.familyId, memberId, timezone: TZ, settings, member: { id: memberId, name: profileName, profileName, permissions: permsOf(profileName) } });
    const fid = await withFamilia(r.familyId, async (tx) => {
      const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, "Familiar"));
      const [m] = await tx.insert(s.members).values({
        familyId: r.familyId, profileId: p!.id, name: "Familiar", email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: "active",
        appwriteUserId: `zz-test-${randomUUID()}`, emailConfirmedAt: new Date(),
      }).returning({ id: s.members.id });
      return m!.id;
    });
    const adm = ator(r.memberId, "Administrador");
    const patientId = await patients.savePatient(adm, { name: `Paciente ${tag}`, birthDate: "", notes: "", usesPhone: true, selfMemberId: null, dataAuthorized: true });
    return { familyId: r.familyId, nome, adm, familiar: ator(fid, "Familiar"), patientId, appwriteUser };
  }

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
  });
  afterAll(async () => {
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await admin`delete from platform_audit_log where route = 'family.purge' and family_id = any(${criadas}::uuid[])`;
    await encerrar(admin);
  });

  it("aceite da política grava a versão e a data na pessoa e deixa trilha na auditoria", async () => {
    const f = await novaFamilia("Aceite");
    const [antes] = await admin`select privacy_accepted_at, privacy_version from members where id = ${f.adm.memberId}`;
    expect(antes).toMatchObject({ privacy_accepted_at: null, privacy_version: null });
    await acceptPrivacy(f.adm);
    const [depois] = await admin`select privacy_accepted_at, privacy_version from members where id = ${f.adm.memberId}`;
    expect(depois!["privacy_version"]).toBe(PRIVACY_VERSION);
    expect(depois!["privacy_accepted_at"]).toBeInstanceOf(Date);
    const [a] = await admin`select action, meta from audit_log where family_id = ${f.familyId} and action = 'privacy.accept'`;
    expect(a!["meta"]).toEqual({ version: PRIVACY_VERSION });
    // o outro membro continua sem aceite
    const [outro] = await admin`select privacy_version from members where id = ${f.familiar.memberId}`;
    expect(outro!["privacy_version"]).toBeNull();
  });

  it("paciente: a declaração de autorização fica registrada (quem e quando) e paciente antigo passa a ter ao marcar", async () => {
    const f = await novaFamilia("Autoriza");
    const [p] = await admin`select data_authorized_at, data_authorized_by from patients where id = ${f.patientId}`;
    expect(p!["data_authorized_by"]).toBe(f.adm.memberId);
    expect(p!["data_authorized_at"]).toBeInstanceOf(Date);

    // paciente "antigo" (sem declaração): editar sem marcar mantém sem; marcar registra
    await admin`update patients set data_authorized_at = null, data_authorized_by = null where id = ${f.patientId}`;
    await patients.savePatient(f.adm, { id: f.patientId, name: "Renomeado", birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    expect((await admin`select data_authorized_at from patients where id = ${f.patientId}`)[0]!["data_authorized_at"]).toBeNull();
    await patients.savePatient(f.adm, { id: f.patientId, name: "Renomeado", birthDate: "", notes: "", usesPhone: true, selfMemberId: null, dataAuthorized: true });
    expect((await admin`select data_authorized_by from patients where id = ${f.patientId}`)[0]!["data_authorized_by"]).toBe(f.adm.memberId);
    // quem já declarou não perde a declaração ao editar sem marcar
    await patients.savePatient(f.adm, { id: f.patientId, name: "Outra vez", birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    expect((await admin`select data_authorized_by from patients where id = ${f.patientId}`)[0]!["data_authorized_by"]).toBe(f.adm.memberId);
  });

  it("pedir e cancelar a exclusão: só o Administrador, digitando o nome; não pede duas vezes", async () => {
    const f = await novaFamilia("Pedido");
    await expect(requestFamilyDeletion(f.familiar, f.nome)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requestFamilyDeletion(f.adm, "outro nome")).rejects.toBeInstanceOf(UserError);
    expect((await admin`select deleted_at from families where id = ${f.familyId}`)[0]!["deleted_at"]).toBeNull();

    const r = await requestFamilyDeletion(f.adm, `  ${f.nome.toUpperCase()}  `); // sem diferenciar maiúsculas nem espaços
    const [fam] = await admin`select deleted_at, deletion_requested_by from families where id = ${f.familyId}`;
    expect(fam!["deleted_at"]).toBeInstanceOf(Date);
    expect(fam!["deletion_requested_by"]).toBe(f.adm.memberId);
    expect(Math.round((r.dueAt.getTime() - (fam!["deleted_at"] as Date).getTime()) / 86_400_000)).toBe(30);
    await expect(requestFamilyDeletion(f.adm, f.nome)).rejects.toThrow(/já está agendada/);

    await expect(cancelFamilyDeletion(f.familiar)).rejects.toBeInstanceOf(ForbiddenError);
    await cancelFamilyDeletion(f.adm);
    expect((await admin`select deleted_at, deletion_requested_by from families where id = ${f.familyId}`)[0]).toMatchObject({ deleted_at: null, deletion_requested_by: null });
    const acoes = (await admin`select action from audit_log where family_id = ${f.familyId} order by at`).map((a) => a["action"]);
    expect(acoes).toEqual(expect.arrayContaining(["family.delete_request", "family.delete_cancel"]));
  });

  it("exportar: só o Administrador; traz os dados da família, nada de outra e nenhum segredo", async () => {
    const A = await novaFamilia("ExportA");
    const B = await novaFamilia("ExportB");
    const segredo = `hash-${randomUUID()}`;
    await withFamilia(A.familyId, (tx) => tx.insert(s.apiKeys).values({ familyId: A.familyId, name: "chave", prefix: "cdf_", keyHash: segredo, scopes: [], createdByMemberId: A.adm.memberId }));
    await admin`update members set verification_code_hash = ${"c".repeat(64)} where id = ${A.familiar.memberId}`;

    await expect(exportFamilyData(A.familiar)).rejects.toBeInstanceOf(ForbiddenError);
    const dados = await exportFamilyData(A.adm);
    const texto = JSON.stringify(dados);
    expect(Object.keys(dados)).toEqual(expect.arrayContaining(["familia", "pessoas", "pacientes", "remedios", "doses", "estoque", "receitas", "auditoria"]));
    expect((dados["pacientes"] as Array<{ name: string }>).map((p) => p.name)).toEqual([`Paciente ExportA`]);
    expect(texto).not.toContain(`Paciente ExportB`);
    expect(texto).not.toContain(B.familyId);
    expect(texto).not.toContain(segredo); // hash da chave de API
    expect(texto).not.toContain("c".repeat(64)); // hash do código de verificação
    expect(texto).not.toContain(A.appwriteUser); // id da conta de login
    expect((await admin`select count(*)::int as n from audit_log where family_id = ${A.familyId} and action = 'family.export'`)[0]!["n"]).toBe(1);
  });

  it("exclusão definitiva: só famílias vencidas, apaga fotos e contas fora do Postgres e depois as linhas; falha no meio não perde o rastro", async () => {
    const vencida = await novaFamilia("Vencida");
    const recente = await novaFamilia("Recente");
    const normal = await novaFamilia("Normal");
    const rx = randomUUID();
    await withFamilia(vencida.familyId, async (tx) => {
      await tx.insert(s.prescriptions).values({ id: rx, familyId: vencida.familyId, patientId: vencida.patientId, issuedOn: "2026-10-01", uploadedByMemberId: vencida.adm.memberId });
      await tx.insert(s.prescriptionFiles).values([
        { familyId: vencida.familyId, prescriptionId: rx, storageFileId: "arq-v-1", mime: "image/jpeg", size: 1, page: 1 },
        { familyId: vencida.familyId, prescriptionId: rx, storageFileId: "arq-v-2", mime: "image/jpeg", size: 1, page: 2 },
      ]);
    });
    await admin`update families set deleted_at = now() - interval '31 days' where id = ${vencida.familyId}`;
    await admin`update families set deleted_at = now() - interval '5 days' where id = ${recente.familyId}`;

    // 1ª rodada: o armazenamento falha → nada do Postgres é apagado (o banco continua sendo o índice do que falta)
    const arquivos: string[] = [];
    const contas: string[] = [];
    const r1 = await excluirFamiliasVencidas({
      removerArquivo: async (id) => { if (id === "arq-v-2") throw new Error("storage fora do ar"); arquivos.push(id); },
      removerConta: async (id) => { contas.push(id); },
    });
    expect(r1).toEqual({ excluidas: 0, falhas: 1 });
    expect((await admin`select count(*)::int as n from families where id = ${vencida.familyId}`)[0]!["n"]).toBe(1);
    expect((await admin`select count(*)::int as n from prescription_files where family_id = ${vencida.familyId}`)[0]!["n"]).toBe(2);
    expect(contas).toEqual([]); // contas só depois de todos os arquivos

    // 2ª rodada: tudo certo (apagar de novo o que já foi apagado não é erro)
    arquivos.length = 0;
    const r2 = await excluirFamiliasVencidas({ removerArquivo: async (id) => { arquivos.push(id); }, removerConta: async (id) => { contas.push(id); } });
    expect(r2).toEqual({ excluidas: 1, falhas: 0 });
    expect(arquivos.sort()).toEqual(["arq-v-1", "arq-v-2"]);
    expect(contas).toHaveLength(2); // o administrador e o familiar
    expect(contas).toContain(vencida.appwriteUser);

    // sumiu de TODAS as tabelas com family_id; as outras ficaram
    const tabelas = (await admin`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'family_id'`).map((t) => t["table_name"] as string);
    for (const t of tabelas.filter((x) => x !== "platform_audit_log")) {
      const [n] = await admin.unsafe(`select count(*)::int as n from "${t}" where family_id = $1`, [vencida.familyId]);
      expect(n!["n"], `${t} ainda tem linhas da família excluída`).toBe(0);
    }
    expect((await admin`select count(*)::int as n from families where id = any(${[recente.familyId, normal.familyId]}::uuid[])`)[0]!["n"]).toBe(2);
    expect((await admin`select count(*)::int as n from patients where family_id = ${recente.familyId}`)[0]!["n"]).toBe(1);

    // fica só o registro sem dado pessoal
    const regs = await admin`select method, route, masked_phone, key_id from platform_audit_log where family_id = ${vencida.familyId}`;
    expect(regs).toEqual([{ method: "JOB", route: "family.purge", masked_phone: null, key_id: null }]);

    // 3ª rodada: nada a fazer
    expect(await excluirFamiliasVencidas({ removerArquivo: async () => { throw new Error("não devia chamar"); }, removerConta: async () => { throw new Error("não devia chamar"); } })).toEqual({ excluidas: 0, falhas: 0 });
  });
});
