// @vitest-environment node
/**
 * PROVA AUTOMÁTICA do Lote 5A: o perfil "Somente leitura" vê e NÃO age.
 *
 * O teste ENUMERA (lendo os arquivos) todas as Server Actions (`server/**` com "use server"), todas as rotas de `app/api/**` e o caminho
 * do WhatsApp, e exige que cada operação esteja CLASSIFICADA aqui. Uma ação ou rota nova sem classificação FAZ O TESTE FALHAR: assim
 * nenhuma escrita futura escapa da conferência. Para cada operação de ESCRITA, um ator "Somente leitura" (com ids reais da família, para
 * a recusa vir da permissão e não de um erro de validação) recebe recusa e o banco fica IDÊNTICO (impressão digital de todas as tabelas
 * da família). Como controle, o Administrador chama a mesma operação e NÃO recebe a recusa de permissão.
 * Papel da APLICAÇÃO (sem BYPASSRLS). Sem o banco no ar, a suíte é PULADA (REQUIRE_DB=1 falha).
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, telefoneAleatorio, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, READ_ONLY_PROFILE_NAME, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import type { Ctx } from "./pg/access";
import type { DoseActor } from "./pg/doses";
import { ensureDosesForDay } from "./pg/doses";
import { createFamilyWithAdmin } from "./pg/families";
import * as meds from "./pg/medications";
import * as patients from "./pg/patients";
import * as rx from "./pg/prescriptions";
import type { RxStorage } from "./pg/rx-storage";
import { registerPurchase } from "./pg/stock";
import { ROUTES } from "./api/registry";
import { simulatorSecret } from "./api/core";
import { processarEntrada, type DepsNucleo } from "./wa/nucleo";
import type { MensagemRecebida } from "./wa/provider/types";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: prova do perfil Somente leitura PULADA. Rode `pnpm db:up`.");

// quem está "logado" nas Server Actions (a sessão real vem do Appwrite; aqui o teste escolhe o contexto)
const sessao = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("./pg/access", async (original) => ({ ...(await original<typeof import("./pg/access")>()), getContext: async () => sessao.ctx }));

const SRC = path.resolve(__dirname, "..");
const TZ = "America/Sao_Paulo";
const DAY = "2026-10-19";
const T0610 = new Date("2026-10-19T09:10:00Z");
const settings = familySettingsSchema.parse({});
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

class FakeStorage implements RxStorage {
  files = new Map<string, { bytes: Buffer; mime: string }>();
  async put(bytes: Buffer, mime: string): Promise<string> { const id = `fake-${randomUUID()}`; this.files.set(id, { bytes, mime }); return id; }
  async remove(id: string): Promise<void> { this.files.delete(id); }
  async read(id: string) { const f = this.files.get(id); return f ? { bytes: f.bytes.buffer as ArrayBuffer, contentType: f.mime } : null; }
}

/* ------------------------------------------------------------------ 1) enumeração */

function arquivos(dir: string, ok: (nome: string) => boolean): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const full = path.join(dir, nome);
    if (statSync(full).isDirectory()) out.push(...arquivos(full, ok));
    else if (ok(nome)) out.push(full);
  }
  return out;
}

/** Toda função/constante exportada de um arquivo "use server" é uma Server Action exposta (mesmo sem estar em `actions*.ts`). */
function acoesDoServidor(): string[] {
  const out: string[] = [];
  for (const f of arquivos(path.join(SRC), (n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n))) {
    const fonte = readFileSync(f, "utf8");
    if (!/^\s*["']use server["']/m.test(fonte.split("\n").slice(0, 3).join("\n"))) continue;
    const rel = path.relative(SRC, f).replace(/\\/g, "/");
    for (const m of fonte.matchAll(/^export (?:async function|function|const) (\w+)/gm)) out.push(`${rel}#${m[1]}`);
  }
  return out.sort();
}

const METODOS = /export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g;
function rotasDoServidor(): string[] {
  const raiz = path.join(SRC, "app", "api");
  const out: string[] = [];
  for (const f of arquivos(raiz, (n) => n === "route.ts")) {
    const caminho = "/api" + path.relative(raiz, path.dirname(f)).replace(/\\/g, "/").replace(/^\.?$/, "").replace(/^(?=.)/, "/").replace(/\[(\w+)\]/g, "{$1}");
    for (const m of readFileSync(f, "utf8").matchAll(METODOS)) out.push(`${m[1]!.toLowerCase()} ${caminho}`);
  }
  return out.sort();
}

/* ------------------------------------------------------------------ 2) classificação (a lista que NÃO pode ficar velha) */

type Classe =
  /** só lê: o perfil pode chamar (a recusa, se houver, é por falta de permissão de LEITURA, como receitas) */
  | "leitura"
  /** ESCREVE ou administra: o perfil "Somente leitura" TEM que ser recusado e o banco não pode mudar */
  | "escrita"
  /** escreve só dados da PRÓPRIA pessoa (telefone, avisos lidos): permitido */
  | "propria"
  /** autenticação, cadastro e convite: não agem sobre a família em nome de um perfil */
  | "autenticacao"
  /** chave de integração (worker, webhook, fila): não existe perfil nem pessoa; só quem tem a chave */
  | "sistema";

const ACOES: Record<string, Classe> = {
  "server/pg/actions.ts#loadSnapshotAction": "leitura",
  "server/pg/actions.ts#confirmDoseAction": "escrita",
  "server/pg/actions.ts#registerLateDoseAction": "escrita",
  "server/pg/actions.ts#undoDoseAction": "escrita",
  "server/pg/actions.ts#snoozeDoseAction": "escrita",
  "server/pg/actions.ts#registerPurchaseAction": "escrita",
  "server/pg/actions.ts#adjustStockAction": "escrita",
  "server/pg/actions.ts#saveNoticeSettingsAction": "escrita",
  "server/pg/actions.ts#saveRxAction": "escrita",
  "server/pg/actions.ts#deleteRxAction": "escrita",
  "server/pg/actions.ts#restoreRxAction": "escrita",
  "server/pg/actions.ts#markSupersededAction": "escrita",
  "server/pg/actions.ts#shareRxAction": "escrita",
  "server/pg/actions.ts#assumeReplenishmentAction": "escrita",
  "server/pg/actions.ts#advanceReplenishmentAction": "escrita",
  "server/pg/actions.ts#cancelReplenishmentAction": "escrita",
  "server/pg/actions.ts#markNoticesReadAction": "propria",
  "server/pg/actions.ts#recordRxViewAction": "leitura",
  "server/pg/actions.ts#loadDoseHistoryAction": "leitura",
  "server/pg/actions.ts#previewStockDaysAction": "leitura",
  "server/pg/actions.ts#inviteMemberAction": "escrita",
  "server/pg/actions.ts#updateMemberAction": "escrita",
  "server/pg/actions.ts#removeMemberAction": "escrita",
  "server/pg/actions.ts#reactivateMemberAction": "escrita",
  "server/pg/actions.ts#revokeInviteAction": "escrita",
  "server/pg/actions.ts#resendInviteAction": "escrita",
  "server/pg/actions.ts#saveMyPhoneAction": "propria",
  "server/pg/actions.ts#setPermissionAction": "escrita",
  "server/pg/actions.ts#savePatientAction": "escrita",
  "server/pg/actions.ts#deletePatientAction": "escrita",
  "server/pg/actions.ts#createMedicationAction": "escrita",
  "server/pg/actions.ts#updateMedicationAction": "escrita",
  "server/pg/actions.ts#deleteMedicationAction": "escrita",
  "server/pg/actions.ts#restoreMedicationAction": "escrita",
  "server/pg/actions.ts#saveSchemeAction": "escrita",

  "server/wa/actions.ts#estadoWhatsappAction": "leitura",
  "server/wa/actions.ts#iniciarVerificacaoAction": "propria",
  "server/wa/actions.ts#removerMeuNumeroAction": "propria",
  "server/wa/actions.ts#criarChaveAction": "escrita",
  "server/wa/actions.ts#revogarChaveAction": "escrita",
  "server/wa/actions.ts#reenviarLinkAcessoAction": "escrita",
  "server/wa/actions.ts#simPessoasAction": "escrita",
  "server/wa/actions.ts#simEnviarAction": "escrita",
  "server/wa/actions.ts#simEnviarAgoraAction": "escrita",
  "server/wa/actions.ts#simFilaAction": "escrita",
  "server/wa/actions.ts#simMarcarEnviadaAction": "escrita",
  "server/wa/actions.ts#consultarInstanciaAction": "escrita",
  "server/wa/actions.ts#definirLimiteIaAction": "escrita",

  "server/pg/auth-actions.ts#signIn": "autenticacao",
  "server/pg/auth-actions.ts#signOut": "autenticacao",
  "server/pg/auth-actions.ts#signUp": "autenticacao",
  "server/pg/auth-actions.ts#resendVerification": "autenticacao",
  "server/pg/auth-actions.ts#checkEmailConfirmed": "autenticacao",
  "server/pg/auth-actions.ts#confirmEmail": "autenticacao",
  "server/pg/auth-actions.ts#createFamily": "autenticacao",
  "server/pg/auth-actions.ts#forgotPassword": "autenticacao",
  "server/pg/auth-actions.ts#resetPassword": "autenticacao",
  "server/pg/auth-actions.ts#acceptInvite": "autenticacao",
  "server/pg/auth-actions.ts#resendInviteEmail": "autenticacao",
  "server/wa/first-access-actions.ts#completeFirstAccess": "autenticacao",
};

/** Rotas de `app/api` que não são `/api/v1` (as do `/api/v1` são classificadas por `handler`, abaixo). */
const ROTAS_FORA_DO_V1: Record<string, Classe> = {
  "get /api/health": "sistema",
  "get /api/rx-file/{fileId}": "leitura",
  "get /api/test/invite-link": "sistema",
  "post /api/whatsapp/evolution/{segredo}": "sistema",
};

const HANDLERS: Record<string, Classe> = {
  dosesProximas: "leitura", dosesDoDia: "leitura", estoqueVisao: "leitura", reposicoesListar: "leitura", receitasListar: "leitura",
  receitasArquivos: "leitura", arquivoReceita: "leitura", pacientesListar: "leitura", remediosListar: "leitura", openapi: "leitura",
  dosesConfirmar: "escrita", dosesRegistrarDepois: "escrita", dosesDesfazer: "escrita", dosesLembrarDeNovo: "escrita",
  reposicoesAssumir: "escrita", reposicoesAvancar: "escrita",
  // a conversa em código escreve (tomei, eu cuido disso): coberta pelo teste do WhatsApp abaixo, com recusa "sem_permissao"
  conversaMensagem: "escrita",
  telefoneVerificar: "propria",
  lembretesPendentes: "sistema", lembreteEnviado: "sistema", avisosEstoque: "sistema", avisosResumo: "sistema", filaCompleta: "sistema", sistemaSaude: "sistema",
};

describe("enumeração: nada novo escapa da classificação", () => {
  it("toda Server Action exportada está classificada (e não há classificação velha)", () => {
    const reais = acoesDoServidor();
    expect(reais.length).toBeGreaterThanOrEqual(40);
    const semClasse = reais.filter((a) => !(a in ACOES));
    expect(semClasse, `Server Action NOVA sem classificação em leitura.contract.integration.test.ts: ${semClasse.join(", ")}`).toEqual([]);
    const velhas = Object.keys(ACOES).filter((a) => !reais.includes(a));
    expect(velhas, `classificação de ação que não existe mais: ${velhas.join(", ")}`).toEqual([]);
  });

  it("toda rota de app/api está classificada (as do /api/v1 pelo handler do registro)", () => {
    const reais = rotasDoServidor();
    expect(reais.length).toBeGreaterThanOrEqual(20);
    const v1 = new Map(ROUTES.map((r) => [`${r.method} /api/v1${r.path}`, r.handler]));
    const semClasse: string[] = [];
    for (const r of reais) {
      if (r.includes("/api/v1/")) {
        const h = v1.get(r);
        if (!h || !(h in HANDLERS)) semClasse.push(r);
      } else if (!(r in ROTAS_FORA_DO_V1)) semClasse.push(r);
    }
    expect(semClasse, `Rota NOVA sem classificação em leitura.contract.integration.test.ts: ${semClasse.join(", ")}`).toEqual([]);
    for (const h of Object.values(Object.fromEntries(ROUTES.map((r) => [r.handler, 1])))) void h;
    const velhasH = Object.keys(HANDLERS).filter((h) => !ROUTES.some((r) => r.handler === h));
    expect(velhasH, `handler classificado que não existe mais: ${velhasH.join(", ")}`).toEqual([]);
    const velhasR = Object.keys(ROTAS_FORA_DO_V1).filter((r) => !reais.includes(r));
    expect(velhasR).toEqual([]);
  });

  it("rota GET nunca escreve em nome de um perfil: método de escrita só em handlers de escrita, próprios ou de sistema", () => {
    for (const r of ROUTES.filter((x) => x.method === "post")) expect(HANDLERS[r.handler], r.path).not.toBe("leitura");
  });
});

/* ------------------------------------------------------------------ 3) execução */

interface Fam {
  familyId: string;
  admin: DoseActor;
  adminPhone: string;
  leitorId: string;
  leitorPhone: string;
  outroId: string;
  patientId: string;
  medId: string;
  doseId: string;
  rxId: string;
}

const ctxOf = (familyId: string, memberId: string, profileName: string, nome: string, permissions: PermissionMap): Ctx => ({
  familyId, familyName: "Família Teste", timezone: TZ, settings,
  account: { id: "x", email: "x@exemplo.test", name: nome, emailVerified: true }, memberId, profileId: "p",
  member: { id: memberId, name: nome, profileName, permissions },
});

describe.skipIf(!up)("Somente leitura: toda escrita é recusada e o banco não muda", () => {
  let admin: Admin;
  const criadas: string[] = [];
  let F: Fam;
  let tabelas: string[] = [];

  /** Impressão digital das tabelas da família (menos bookkeeping da conversa e avisos do sino, que rotinas em segundo plano de outras suítes também gravam). */
  async function impressao(): Promise<string> {
    const partes: string[] = [];
    for (const t of tabelas) {
      const col = t === "families" ? "id" : "family_id";
      const [r] = await admin.unsafe(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from ${t} x where ${col} = $1`, [F.familyId]);
      partes.push(`${t}:${r!["n"]}:${r!["h"]}`);
    }
    return partes.join("\n");
  }

  beforeAll(async () => {
    process.env["FILE_URL_SECRET"] = "segredo-de-teste-com-mais-de-16-caracteres";
    process.env["SIMULATOR_ENABLED"] = "1";
    process.env["APP_URL"] = "http://app.local";
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
    tabelas = ((await admin`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'family_id'`).map((r) => r["table_name"] as string))
      .concat("families")
      .filter((t) => !["message_log", "conversation_state", "idempotency", "platform_audit_log", "ai_usage", "notifications"].includes(t))
      .sort();

    const r = await createFamilyWithAdmin({ appwriteUserId: `zz-test-${randomUUID()}`, name: "Admin Leitura", email: `zz-test-leitura-${randomUUID().slice(0, 6)}@exemplo.test`, familyName: "Família Leitura" });
    criadas.push(r.familyId);
    const a: DoseActor = { familyId: r.familyId, memberId: r.memberId, timezone: TZ, settings, member: { id: r.memberId, name: "Admin Leitura", profileName: "Administrador", permissions: permsOf("Administrador") } };
    const adminPhone = telefoneAleatorio();
    await withFamilia(r.familyId, (tx) => tx.update(s.members).set({ phoneVerified: adminPhone }).where(eq(s.members.id, r.memberId)));
    const patientId = await patients.savePatient(a, { name: "Adelino Leitura", birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medId = await meds.createMedication(a, { patientId, name: "Zypred Leitura", alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: true });
    await meds.saveScheme(a, medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
    await registerPurchase(a, medId, 30, "Saldo inicial");
    await ensureDosesForDay(r.familyId, DAY);
    const [dose] = await withFamilia(r.familyId, (tx) => tx.select({ id: s.doseEvents.id }).from(s.doseEvents).orderBy(s.doseEvents.scheduledAt));
    const rxId = await rx.saveRx(a, { patientId, date: "19/10/2026", doctor: "Dra. Helena", specialty: "Oftalmologia", medicationIds: [medId], validity: "30", notes: "" }, [{ bytes: JPEG }], { storage: new FakeStorage(), now: T0610 });

    const mk = async (perfil: string, nome: string) => {
      const phone = telefoneAleatorio();
      const id = await withFamilia(r.familyId, async (tx) => {
        const [p] = await tx.select().from(s.profiles).where(eq(s.profiles.name, perfil));
        const [m] = await tx.insert(s.members).values({
          familyId: r.familyId, profileId: p!.id, name: nome, email: `zz-test-${randomUUID().slice(0, 8)}@exemplo.test`, accessState: "active",
          appwriteUserId: `zz-test-${randomUUID()}`, emailConfirmedAt: new Date(), phoneVerified: phone,
        }).returning({ id: s.members.id });
        return m!.id;
      });
      return { id, phone };
    };
    const leitor = await mk(READ_ONLY_PROFILE_NAME, "Sobrinho Leitor");
    const outro = await mk("Familiar", "Tia Familiar");
    F = { familyId: r.familyId, admin: a, adminPhone, leitorId: leitor.id, leitorPhone: leitor.phone, outroId: outro.id, patientId, medId, doseId: dose!.id, rxId };
  }, 60_000);

  afterAll(async () => {
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  /** Como o servidor monta o contexto: relê o perfil no banco a cada chamada (o administrador pode ter liberado a leitura de receitas). */
  const comoLeitor = async () => {
    const [p] = await admin`select permissions from profiles where family_id = ${F.familyId} and name = ${READ_ONLY_PROFILE_NAME}`;
    sessao.ctx = ctxOf(F.familyId, F.leitorId, READ_ONLY_PROFILE_NAME, "Sobrinho Leitor", p!["permissions"] as PermissionMap);
  };
  const comoAdmin = () => { sessao.ctx = ctxOf(F.familyId, F.admin.memberId, "Administrador", "Admin Leitura", permsOf("Administrador")); };

  /* ------------------------------ Server Actions de escrita: chamada com ids REAIS */
  const novoPaciente = { name: "Novo Paciente", birthDate: "", notes: "", usesPhone: true, selfMemberId: null };
  const formRx = () => {
    const f = new FormData();
    f.set("draft", JSON.stringify({ patientId: F.patientId, date: "19/10/2026", doctor: "Dr. X", specialty: "", medicationIds: [F.medId], validity: "30", notes: "" }));
    f.append("files", new File([JPEG], "r.jpg", { type: "image/jpeg" }));
    return f;
  };
  type Chamada = { chamar: () => Promise<unknown>; /** o controle do Administrador chama serviços externos (e-mail, Appwrite, bucket): não roda */ semControle?: boolean; recusa?: RegExp };
  const escritas = async (): Promise<Record<string, Chamada>> => {
    const A = await import("./pg/actions");
    const W = await import("./wa/actions");
    return {
      "server/pg/actions.ts#confirmDoseAction": { chamar: () => A.confirmDoseAction(F.doseId) },
      "server/pg/actions.ts#registerLateDoseAction": { chamar: () => A.registerLateDoseAction(F.doseId) },
      "server/pg/actions.ts#undoDoseAction": { chamar: () => A.undoDoseAction(F.doseId) },
      "server/pg/actions.ts#snoozeDoseAction": { chamar: () => A.snoozeDoseAction(F.doseId, 15) },
      "server/pg/actions.ts#registerPurchaseAction": { chamar: () => A.registerPurchaseAction(F.medId, 10) },
      "server/pg/actions.ts#adjustStockAction": { chamar: () => A.adjustStockAction(F.medId, 5, "contei") },
      "server/pg/actions.ts#saveNoticeSettingsAction": { chamar: () => A.saveNoticeSettingsAction({ leadDays: 5 }) },
      "server/pg/actions.ts#saveRxAction": { chamar: () => A.saveRxAction(formRx()), semControle: true },
      "server/pg/actions.ts#deleteRxAction": { chamar: () => A.deleteRxAction(F.rxId) },
      "server/pg/actions.ts#restoreRxAction": { chamar: () => A.restoreRxAction(F.rxId) },
      "server/pg/actions.ts#markSupersededAction": { chamar: () => A.markSupersededAction(F.rxId) },
      "server/pg/actions.ts#shareRxAction": { chamar: () => A.shareRxAction(F.rxId, { memberIds: [F.outroId] }) },
      "server/pg/actions.ts#assumeReplenishmentAction": { chamar: () => A.assumeReplenishmentAction(F.medId) },
      "server/pg/actions.ts#advanceReplenishmentAction": { chamar: () => A.advanceReplenishmentAction(F.medId) },
      "server/pg/actions.ts#cancelReplenishmentAction": { chamar: () => A.cancelReplenishmentAction(F.medId) },
      "server/pg/actions.ts#inviteMemberAction": { chamar: () => A.inviteMemberAction({ name: "Convidado", phone: telefoneAleatorio(), profileName: "Familiar", relation: "", kind: "whatsapp" }) },
      "server/pg/actions.ts#updateMemberAction": { chamar: () => A.updateMemberAction(F.outroId, { name: "Tia Renomeada", profileName: "Familiar", relation: "tia" }) },
      "server/pg/actions.ts#removeMemberAction": { chamar: () => A.removeMemberAction(F.outroId), semControle: true },
      "server/pg/actions.ts#reactivateMemberAction": { chamar: () => A.reactivateMemberAction(F.outroId), semControle: true },
      "server/pg/actions.ts#revokeInviteAction": { chamar: () => A.revokeInviteAction(F.outroId) },
      "server/pg/actions.ts#resendInviteAction": { chamar: () => A.resendInviteAction(F.outroId), semControle: true },
      "server/pg/actions.ts#setPermissionAction": { chamar: () => A.setPermissionAction("confirm", "Cuidadora", false) },
      "server/pg/actions.ts#savePatientAction": { chamar: () => A.savePatientAction(novoPaciente) },
      "server/pg/actions.ts#deletePatientAction": { chamar: () => A.deletePatientAction(F.patientId) },
      "server/pg/actions.ts#createMedicationAction": { chamar: () => A.createMedicationAction({ patientId: F.patientId, name: "Outro", alternatives: [], routeLabel: "Comprimido", unitLabel: "Unidade" }) },
      "server/pg/actions.ts#updateMedicationAction": { chamar: () => A.updateMedicationAction(F.medId, { name: "Renomeado" }) },
      "server/pg/actions.ts#deleteMedicationAction": { chamar: () => A.deleteMedicationAction(F.medId) },
      "server/pg/actions.ts#restoreMedicationAction": { chamar: () => A.restoreMedicationAction(F.medId) },
      "server/pg/actions.ts#saveSchemeAction": { chamar: () => A.saveSchemeAction(F.medId, { single: true, firstTime: "07:00", phases: [{ everyHours: 12, fromDay: 1, toDay: null, perDose: 1 }] }) },
      "server/wa/actions.ts#criarChaveAction": { chamar: () => W.criarChaveAction("Chave de teste"), recusa: /Administrador|permissão/ },
      "server/wa/actions.ts#revogarChaveAction": { chamar: () => W.revogarChaveAction(randomUUID()), recusa: /Administrador|permissão/ },
      "server/wa/actions.ts#reenviarLinkAcessoAction": { chamar: () => W.reenviarLinkAcessoAction(F.outroId) },
      "server/wa/actions.ts#simPessoasAction": { chamar: () => W.simPessoasAction() },
      "server/wa/actions.ts#simEnviarAction": { chamar: () => W.simEnviarAction({ telefone: F.leitorPhone, texto: "tomei" }), semControle: true },
      "server/wa/actions.ts#simEnviarAgoraAction": { chamar: () => W.simEnviarAgoraAction(), semControle: true },
      "server/wa/actions.ts#simFilaAction": { chamar: () => W.simFilaAction(), semControle: true },
      "server/wa/actions.ts#simMarcarEnviadaAction": { chamar: () => W.simMarcarEnviadaAction(`${F.familyId}.${randomUUID()}`), semControle: true },
      "server/wa/actions.ts#consultarInstanciaAction": { chamar: () => W.consultarInstanciaAction(), semControle: true },
      "server/wa/actions.ts#definirLimiteIaAction": { chamar: () => W.definirLimiteIaAction(5) },
    };
  };

  const NEGADO = /não tem permissão|Só um Administrador|Sem permissão/;
  const negou = (r: unknown, recusa: RegExp = NEGADO) => {
    const x = r as { ok?: boolean; message?: string };
    return x.ok === false && recusa.test(x.message ?? "");
  };

  it("as ações de escrita enumeradas têm uma chamada de teste cada (nenhuma sem prova)", async () => {
    const chamadas = await escritas();
    const marcadas = Object.entries(ACOES).filter(([, c]) => c === "escrita").map(([k]) => k).sort();
    expect(Object.keys(chamadas).sort()).toEqual(marcadas);
  });

  it("Server Actions de escrita: o leitor é recusado e o banco fica idêntico", async () => {
    const chamadas = await escritas();
    const detalhes: string[] = [];
    for (const [nome, c] of Object.entries(chamadas)) {
      await comoLeitor();
      const antes = await impressao();
      const r = await c.chamar();
      if (!negou(r, c.recusa)) detalhes.push(`${nome}: o leitor NÃO foi recusado → ${JSON.stringify(r).slice(0, 160)}`);
      if ((await impressao()) !== antes) detalhes.push(`${nome}: o banco MUDOU depois da recusa`);
    }
    expect(detalhes).toEqual([]);
  }, 180_000);

  it("ações próprias e de leitura continuam permitidas ao leitor, sem vazar dados de outras pessoas", async () => {
    await comoLeitor();
    const A = await import("./pg/actions");
    const W = await import("./wa/actions");
    expect((await A.loadSnapshotAction()).ok).toBe(true);
    expect((await A.markNoticesReadAction()).ok).toBe(true);
    expect((await A.saveMyPhoneAction("")).ok).toBe(true);
    const estado = await W.estadoWhatsappAction();
    expect(estado.ok).toBe(true);
    if (estado.ok) {
      expect(estado.data.pessoas).toEqual([]); // telefones de outras pessoas
      expect(estado.data.chaves).toEqual([]);
      expect(estado.data.status).toBeNull();
      expect(estado.data.simulador).toBe(false);
    }
    // histórico e estoque são de leitura e o perfil tem as permissões
    expect((await A.loadDoseHistoryAction({})).ok).toBe(true);
    expect((await A.previewStockDaysAction(F.medId, 1)).ok).toBe(true);
    // receita é documento de saúde: oculta por padrão, também para a ação de registrar visualização
    expect(negou(await A.recordRxViewAction(F.rxId))).toBe(true);
  });

  it("o retrato que vai ao navegador omite pessoas, matriz de perfis, auditoria, chaves e receitas", async () => {
    await comoLeitor();
    const { loadSnapshotAction } = await import("./pg/actions");
    const r = await loadSnapshotAction();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const snap = r.snapshot;
    expect(snap.people).toEqual([]);
    expect(snap.permissionRows).toEqual([]);
    expect(snap.rxAudience).toEqual([]);
    expect(snap.prescriptions).toEqual([]);
    expect(snap.simulatorEnabled).toBe(false);
    const texto = JSON.stringify(snap);
    expect(texto).not.toContain(F.adminPhone);
    expect(texto).not.toMatch(/zz-test-[a-z0-9-]+@exemplo\.test/);
    expect(snap.patients.length).toBeGreaterThan(0);
    expect(snap.medications.length).toBeGreaterThan(0);
  });

  it("depois que o administrador libera SÓ a leitura de receitas, o leitor vê, mas continua sem anexar, compartilhar ou excluir", async () => {
    comoAdmin();
    const A = await import("./pg/actions");
    expect((await A.setPermissionAction("prescriptions_view", READ_ONLY_PROFILE_NAME, true)).ok).toBe(true);
    // ligar qualquer linha de ação é recusado pelo SERVIDOR, com mensagem clara
    for (const linha of ["confirm", "edit_meds", "stock", "prescriptions_upload", "prescriptions_share", "prescriptions_delete", "users"]) {
      const antes = await impressao();
      const r = await A.setPermissionAction(linha, READ_ONLY_PROFILE_NAME, true);
      expect(r.ok, linha).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/Somente leitura não pode ter permissões de ação/);
      expect(await impressao(), linha).toBe(antes);
    }
    await comoLeitor();
    expect(negou(await A.deleteRxAction(F.rxId))).toBe(true);
    expect(negou(await A.shareRxAction(F.rxId, { memberIds: [F.outroId] }))).toBe(true);
    expect(negou(await A.saveRxAction(formRx()))).toBe(true);
    expect((await A.recordRxViewAction(F.rxId)).ok).toBe(true);
    const snap = await A.loadSnapshotAction();
    expect(snap.ok && snap.snapshot.prescriptions.length).toBeGreaterThan(0);
    comoAdmin();
    await A.setPermissionAction("prescriptions_view", READ_ONLY_PROFILE_NAME, false);
  });

  it("mesmo com o mapa de permissões ADULTERADO no banco (todas ligadas), as ações de escrita continuam recusadas", async () => {
    const todas = Object.fromEntries(Object.keys(permsOf("Administrador")).map((k) => [k, true]));
    await admin`update profiles set permissions = ${admin.json(todas)} where family_id = ${F.familyId} and name = ${READ_ONLY_PROFILE_NAME}`;
    try {
      const { getAccess } = await import("./pg/access");
      void getAccess; // o contexto real relê o perfil; aqui o mapa adulterado entra no ctx como o servidor o montaria
      sessao.ctx = ctxOf(F.familyId, F.leitorId, READ_ONLY_PROFILE_NAME, "Sobrinho Leitor", todas);
      const chamadas = await escritas();
      for (const nome of ["server/pg/actions.ts#confirmDoseAction", "server/pg/actions.ts#adjustStockAction", "server/pg/actions.ts#savePatientAction", "server/pg/actions.ts#deleteRxAction", "server/pg/actions.ts#assumeReplenishmentAction", "server/pg/actions.ts#inviteMemberAction"]) {
        const antes = await impressao();
        expect(negou(await chamadas[nome]!.chamar()), nome).toBe(true);
        expect(await impressao(), nome).toBe(antes);
      }
    } finally {
      await admin`update profiles set permissions = ${admin.json(permsOf(READ_ONLY_PROFILE_NAME))} where family_id = ${F.familyId} and name = ${READ_ONLY_PROFILE_NAME}`;
    }
  });

  /* ------------------------------ rotas /api/v1 */
  const H = async () => import("./api/handlers");
  const req = (metodo: "GET" | "POST", caminho: string, telefone: string, corpo: unknown = {}) =>
    new NextRequest(`http://api.local/api/v1${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", "x-mc-simulador": simulatorSecret(), "x-mc-simulador-familia": F.familyId, "x-telefone": telefone },
      ...(metodo === "POST" ? { body: JSON.stringify(corpo) } : {}),
    });
  const ctxRota = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

  const rotasEscrita = async () => {
    const h = await H();
    return {
      dosesConfirmar: (tel: string) => h.dosesConfirmar(req("POST", `/doses/${F.doseId}/confirmar`, tel, { messageId: `zz-${randomUUID()}` }), ctxRota({ id: F.doseId })),
      dosesRegistrarDepois: (tel: string) => h.dosesRegistrarDepois(req("POST", `/doses/${F.doseId}/registrar-depois`, tel, {}), ctxRota({ id: F.doseId })),
      dosesDesfazer: (tel: string) => h.dosesDesfazer(req("POST", `/doses/${F.doseId}/desfazer`, tel), ctxRota({ id: F.doseId })),
      dosesLembrarDeNovo: (tel: string) => h.dosesLembrarDeNovo(req("POST", `/doses/${F.doseId}/lembrar-de-novo`, tel, { minutos: 15 }), ctxRota({ id: F.doseId })),
      reposicoesAssumir: (tel: string) => h.reposicoesAssumir(req("POST", `/reposicoes/${F.medId}/assumir`, tel), ctxRota({ id: F.medId })),
      reposicoesAvancar: (tel: string) => h.reposicoesAvancar(req("POST", `/reposicoes/${F.medId}/avancar`, tel, {}), ctxRota({ id: F.medId })),
    } as Record<string, (tel: string) => Promise<Response>>;
  };

  it("as rotas de escrita da API têm uma chamada de teste cada", async () => {
    const marcadas = Object.entries(HANDLERS).filter(([h, c]) => c === "escrita" && h !== "conversaMensagem").map(([h]) => h).sort();
    expect(Object.keys(await rotasEscrita()).sort()).toEqual(marcadas);
  });

  it("API: toda rota de escrita responde 403 ao leitor e o banco fica idêntico", async () => {
    const rotas = await rotasEscrita();
    const detalhes: string[] = [];
    for (const [nome, chamar] of Object.entries(rotas)) {
      const antes = await impressao();
      const resp = await chamar(F.leitorPhone);
      const corpo = (await resp.json()) as { erro?: { codigo?: string } };
      if (resp.status !== 403 || corpo.erro?.codigo !== "sem_permissao") detalhes.push(`${nome}: esperado 403 sem_permissao, veio ${resp.status} ${JSON.stringify(corpo).slice(0, 120)}`);
      if ((await impressao()) !== antes) detalhes.push(`${nome}: o banco MUDOU`);
    }
    expect(detalhes).toEqual([]);
  });

  it("API: as leituras funcionam para o leitor, menos receitas (documento de saúde, oculto por padrão)", async () => {
    const h = await H();
    expect((await h.dosesProximas(req("GET", "/doses/proximas", F.leitorPhone), ctxRota())).status).toBe(200);
    expect((await h.estoqueVisao(req("GET", "/estoque", F.leitorPhone), ctxRota())).status).toBe(200);
    expect((await h.pacientesListar(req("GET", "/pacientes", F.leitorPhone), ctxRota())).status).toBe(200);
    expect((await h.receitasListar(req("GET", "/receitas", F.leitorPhone), ctxRota())).status).toBe(403);
    expect((await h.receitasArquivos(req("GET", `/receitas/${F.rxId}/arquivos`, F.leitorPhone), ctxRota({ id: F.rxId }))).status).toBe(403);
  });

  /* ------------------------------ WhatsApp (conversa em código) */
  const deps = (): DepsNucleo => ({ agente: { modelo: null, agora: () => T0610 }, midia: null, agora: () => T0610 });
  const msg = (telefone: string, texto: string, acao = ""): MensagemRecebida => ({
    msgId: `zz-${randomUUID()}`, telefone, numeroResposta: telefone, tipo: acao ? "botao" : "texto", texto, acao, aviso: "", mime: "", base64: "", segundos: 0, midiaRef: null, idadeSegundos: 0,
  });

  it("WhatsApp: tomei, 1, 2, tomei todos, um por um, eu cuido disso e os botões de ação respondem 'seu perfil não permite' e nada muda", async () => {
    const entradas: Array<[string, string]> = [
      ["tomei", ""], ["Tomei!", ""], ["1", ""], ["2", ""], ["tomei todos", ""], ["um por um", ""], ["eu cuido disso", ""], ["", "tomei"], ["", "lembrar"], ["", "cuido"],
    ];
    for (const [texto, acao] of entradas) {
      const antes = await impressao();
      const r = await processarEntrada(msg(F.leitorPhone, texto, acao), deps());
      expect(r.respostas.join("\n"), `"${texto || acao}"`).toMatch(/Seu perfil não permite|Seu perfil é só de acompanhamento|Não entendi|ajuda|Só pelo portal|Nenhuma dose|nada/i);
      expect(r.respostas.join("\n")).not.toMatch(/anotad|tomou|assumiu/i);
      expect(await impressao(), `"${texto || acao}"`).toBe(antes);
    }
    // as que são ações de verdade (tomei, tomei todos, eu cuido disso) dão a recusa clara do perfil
    for (const texto of ["tomei", "tomei todos", "eu cuido disso"]) {
      const r = await processarEntrada(msg(F.leitorPhone, texto), deps());
      expect(r.respostas.join("\n"), texto).toMatch(/Seu perfil não permite/);
    }
    // nenhuma confirmação nasceu: a dose segue aberta e o estoque intacto
    const [d] = await admin`select status from dose_events where id = ${F.doseId}`;
    expect(d!["status"]).not.toBe("taken");
    // o controle: o Administrador consegue confirmar pelo mesmo caminho
    const ok = await processarEntrada(msg(F.adminPhone, "tomei"), deps());
    expect(ok.intent).not.toBe("sem_permissao");
  });

  it("WhatsApp: PARAR e REATIVAR continuam permitidos ao leitor; ele ainda consulta estoque e próximas doses", async () => {
    const parar = await processarEntrada(msg(F.leitorPhone, "PARAR"), deps());
    expect(parar.intent).toBe("parar");
    const [m1] = await admin`select whatsapp_opt_out_at from members where id = ${F.leitorId}`;
    expect(m1!["whatsapp_opt_out_at"]).not.toBeNull();
    const reativar = await processarEntrada(msg(F.leitorPhone, "reativar"), deps());
    expect(reativar.intent).toBe("reativar");
    const consulta = await processarEntrada(msg(F.leitorPhone, "estoque"), deps());
    expect(consulta.intent).not.toBe("sem_permissao");
    const proximas = await processarEntrada(msg(F.leitorPhone, "próximas doses"), deps());
    expect(proximas.intent).not.toBe("sem_permissao");
  });
  /* ------------------------------ controle (por último: o Administrador altera de verdade a família de teste) */
  it("controle: o Administrador chama as MESMAS operações e não recebe a recusa (a recusa do leitor é mesmo do perfil)", async () => {
    const chamadas = await escritas();
    comoAdmin();
    const semRecusa: string[] = [];
    for (const [nome, c] of Object.entries(chamadas)) {
      if (c.semControle) continue;
      const r = await c.chamar();
      if (negou(r)) semRecusa.push(`${nome}: o Administrador também foi recusado → ${JSON.stringify(r).slice(0, 160)}`);
    }
    expect(semRecusa).toEqual([]);
    const rotas = await rotasEscrita();
    for (const [nome, chamar] of Object.entries(rotas)) {
      const resp = await chamar(F.adminPhone);
      expect(resp.status, `${nome} (controle do Administrador)`).not.toBe(403);
    }
  }, 180_000);
});
