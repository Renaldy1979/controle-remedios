// @vitest-environment node
/**
 * Integração do Lote 3 contra o Postgres local (pnpm db:up): receitas (anexar, substituir, excluir com desfazer, compartilhar,
 * quem viu, entrega de arquivo), avisos de validade (uma vez por limite), reposição em 4 etapas (abre sozinha, duas pessoas
 * nunca na mesma etapa, compra soma ao estoque uma única vez) e RLS entre duas famílias. Papel da APLICAÇÃO (sem BYPASSRLS).
 * O bucket do Appwrite é trocado por um armazenamento em memória (a ida ao Appwrite real é coberta pelo roteiro e pelo e2e).
 * Sem o banco no ar, a suíte é PULADA.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, type Admin } from "@medcuidar/pg-testing";
import { SYSTEM_PROFILES, familySettingsSchema, type PermissionMap } from "@medcuidar/shared";
import type { Ctx } from "./access";
import { ForbiddenError, UserError } from "./errors";
import { createFamilyWithAdmin } from "./families";
import { ensureDosesForDay, listDoseHistory, type DoseActor } from "./doses";
import * as meds from "./medications";
import { listNotices } from "./notices";
import * as patients from "./patients";
import * as rx from "./prescriptions";
import * as repl from "./replenishment";
import { buildSnapshot } from "./snapshot";
import { adjustStock, evaluateLowStockForFamily, registerPurchase } from "./stock";
import type { RxStorage } from "./rx-storage";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes de integração do Lote 3 PULADOS. Rode `pnpm db:up`.");

const DAY = "2026-10-19";
const NOON = new Date("2026-10-19T15:00:00Z");
const TZ = "America/Sao_Paulo";
const at = (ymd: string) => new Date(`${ymd}T15:00:00Z`);
const permsOf = (name: string): PermissionMap => SYSTEM_PROFILES.find((p) => p.name === name)!.permissions;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 3)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");

/** Substitui o bucket do Appwrite: guarda na memória e deixa simular falha no envio. */
class FakeStorage implements RxStorage {
  files = new Map<string, { bytes: Buffer; mime: string }>();
  failOnPut: number | null = null;
  private puts = 0;
  async put(bytes: Buffer, mime: string): Promise<string> {
    this.puts += 1;
    if (this.failOnPut !== null && this.puts >= this.failOnPut) throw new UserError("Armazenamento fora do ar (teste).");
    const id = `fake-${randomUUID()}`;
    this.files.set(id, { bytes, mime });
    return id;
  }
  async remove(id: string): Promise<void> {
    this.files.delete(id);
  }
  async read(id: string) {
    const f = this.files.get(id);
    return f ? { bytes: f.bytes.buffer as ArrayBuffer, contentType: f.mime } : null;
  }
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

interface Fam {
  familyId: string;
  admin: DoseActor;
  patientId: string;
  /** remédio que EXIGE receita, 3 doses por dia, estoque inicial de 60 */
  medId: string;
}

describe.skipIf(!up)("Lote 3 — receitas e reposição no Postgres", () => {
  let admin: Admin;
  const criadas: string[] = [];
  let store: FakeStorage;

  async function novaFamilia(nome: string, o: { requires?: boolean; stock?: number } = {}): Promise<Fam> {
    const r = await createFamilyWithAdmin({
      appwriteUserId: `zz-test-${randomUUID()}`, name: `Admin ${nome}`, email: `zz-test-${nome}-${randomUUID().slice(0, 6)}@exemplo.test`.toLowerCase(), familyName: `Família ${nome}`,
    });
    criadas.push(r.familyId);
    const a = actorOf(r.familyId, r.memberId, "Administrador", `Admin ${nome}`);
    const patientId = await patients.savePatient(a, { name: `Paciente ${nome}`, birthDate: "", notes: "", usesPhone: true, selfMemberId: null });
    const medId = await meds.createMedication(a, { patientId, name: `Remédio ${nome}`, alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: o.requires ?? true, initialStock: o.stock ?? 60 });
    await meds.saveScheme(a, medId, { startDate: DAY, firstTime: "06:00", phases: [{ everyHours: 8, fromDay: 1, toDay: null, perDose: 1 }] });
    await ensureDosesForDay(r.familyId, DAY);
    return { familyId: r.familyId, admin: a, patientId, medId };
  }

  const draft = (f: Fam, over: Partial<rx.RxDraftInput> = {}): rx.RxDraftInput => ({
    patientId: f.patientId, date: "19/10/2026", doctor: "Dra. Helena Prado", specialty: "Oftalmologia", medicationIds: [f.medId], validity: "30", notes: "Pingar à noite", ...over,
  });
  const save = (a: DoseActor, d: rx.RxDraftInput, files: Buffer[] = [JPEG], now = NOON) => rx.saveRx(a, d, files.map((bytes) => ({ bytes })), { storage: store, now });
  const rxRow = async (id: string) => (await admin`select *, issued_on::text as issued_on, valid_until::text as valid_until from prescriptions where id = ${id}`)[0]!;
  const noticesOf = async (f: Fam, kind: string) => (await admin`select member_id, title, dedupe_key from notifications where family_id = ${f.familyId} and kind = ${kind}`) as unknown as Array<{ member_id: string; title: string; dedupe_key: string }>;
  const balance = async (f: Fam) => (await admin`select coalesce(sum(m.quantity), 0)::float8 as t from stock_movements m join stock_items i on i.id = m.stock_item_id where i.family_id = ${f.familyId} and i.medication_id = ${f.medId}`)[0]!["t"] as number;
  const openRepl = async (f: Fam) => (await admin`select * from replenishments where family_id = ${f.familyId} and status not in ('done','cancelled')`) as unknown as Array<Record<string, unknown>>;
  const stepsOf = async (replId: string) => (await admin`select * from replenishment_steps where replenishment_id = ${replId} order by step`) as unknown as Array<Record<string, unknown>>;
  /** baixa o estoque até o limite (7 dias) pelo ajuste manual: 3 doses por dia, 6 unidades = 2 dias */
  const lowStock = (f: Fam) => adjustStock(f.admin, f.medId, 6, "conferi", NOON);

  beforeAll(async () => {
    process.env["FILE_URL_SECRET"] = "segredo-de-teste-com-mais-de-16-caracteres";
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
  });
  afterAll(async () => {
    await admin.unsafe("delete from audit_log where family_id = any($1::uuid[])", [criadas]);
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  describe("anexar receita", () => {
    it("salva receita, remédios e páginas (o tipo vem dos bytes) e a auditoria guarda só ids", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Anexa");
      const id = await save(f.admin, draft(f), [JPEG, PNG, PDF]);
      const r = await rxRow(id);
      expect(r).toMatchObject({ patient_id: f.patientId, issued_on: "2026-10-19", valid_until: "2026-11-18", status: "valid", doctor_name: "Dra. Helena Prado", uploaded_by_member_id: f.admin.memberId });
      const files = await admin`select page, mime, size from prescription_files where prescription_id = ${id} order by page`;
      expect(files.map((x) => [x["page"], x["mime"]])).toEqual([[1, "image/jpeg"], [2, "image/png"], [3, "application/pdf"]]);
      expect(store.files.size).toBe(3);
      expect((await admin`select medication_id from prescription_items where prescription_id = ${id}`).map((x) => x["medication_id"])).toEqual([f.medId]);
      const [a] = await admin`select meta from audit_log where family_id = ${f.familyId} and action = 'rx.attached'`;
      expect(a!["meta"]).toMatchObject({ patientId: f.patientId, medicationIds: [f.medId], pages: 3 });
      expect(JSON.stringify(a!["meta"])).not.toMatch(/Helena|Pingar|Oftalmologia/); // nada clínico em texto
    });

    it("validade: 30 dias, 60 dias, 6 meses (180 dias) ou sem validade", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Validade");
      const dias = async (validity: rx.RxDraftInput["validity"]) => (await rxRow(await save(f.admin, draft(f, { validity }))))["valid_until"];
      expect(await dias("30")).toBe("2026-11-18");
      expect(await dias("60")).toBe("2026-12-18");
      expect(await dias("180")).toBe("2027-04-17");
      expect(await dias("none")).toBeNull();
    });

    it("recusa arquivo que não é foto/PDF, mais de 20 páginas, página de mais de 15 MB, data futura e sem remédio; nada sobe", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Recusa");
      await expect(save(f.admin, draft(f), [Buffer.from("isto é texto, não imagem")])).rejects.toThrow(/fotos/);
      await expect(save(f.admin, draft(f), Array.from({ length: 21 }, () => JPEG))).rejects.toThrow(/20 páginas/);
      await expect(save(f.admin, draft(f), [Buffer.concat([JPEG, Buffer.alloc(15 * 1024 * 1024)])])).rejects.toThrow(/15 MB/);
      await expect(save(f.admin, draft(f, { date: "20/10/2026" }))).rejects.toThrow(/data/);
      await expect(save(f.admin, draft(f, { date: "31/02/2026" }))).rejects.toThrow(/data/);
      await expect(save(f.admin, draft(f, { medicationIds: [] }))).rejects.toThrow(/remédio/);
      await expect(save(f.admin, draft(f), [])).rejects.toThrow(/pelo menos uma página/);
      expect(store.files.size).toBe(0);
      expect((await admin`select count(*)::int as n from prescriptions where family_id = ${f.familyId}`)[0]!["n"]).toBe(0);
    });

    it("falha no meio do envio ou no banco apaga as páginas que já tinham subido", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Falha");
      store.failOnPut = 2;
      await expect(save(f.admin, draft(f), [JPEG, JPEG, JPEG])).rejects.toThrow(/fora do ar/);
      expect(store.files.size).toBe(0);
      store.failOnPut = null;
      const outra = await novaFamilia("FalhaOutra");
      await expect(save(f.admin, draft(f, { medicationIds: [outra.medId] }), [JPEG, PNG])).rejects.toBeInstanceOf(UserError); // remédio de outra família
      expect(store.files.size).toBe(0);
      expect((await admin`select count(*)::int as n from prescriptions where family_id in (${f.familyId}, ${outra.familyId})`)[0]!["n"]).toBe(0);
    });

    it("editar muda os dados e os remédios sem mexer nas páginas", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Edita");
      const m2 = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Segundo", alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: true });
      const id = await save(f.admin, draft(f));
      await rx.saveRx(f.admin, draft(f, { editId: id, medicationIds: [m2], doctor: "Dr. Outro", validity: "60", controlled: true, copies: 2 }), [], { storage: store, now: NOON });
      expect(await rxRow(id)).toMatchObject({ doctor_name: "Dr. Outro", valid_until: "2026-12-18", is_controlled: true, copies: 2 });
      expect((await admin`select medication_id from prescription_items where prescription_id = ${id}`).map((x) => x["medication_id"])).toEqual([m2]);
      expect((await admin`select count(*)::int as n from prescription_files where prescription_id = ${id}`)[0]!["n"]).toBe(1);
    });
  });

  describe("situação e substituição", () => {
    it("a nova receita substitui as vencidas e as 'aguardando nova' do mesmo paciente com remédio em comum, e só elas", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Subst");
      const outro = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Outro remédio", alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: true });
      const vencida = await save(f.admin, draft(f, { date: "01/08/2026", validity: "30" })); // venceu em 31/08
      const vencidaOutro = await save(f.admin, draft(f, { date: "01/08/2026", validity: "30", medicationIds: [outro] })); // vencida, mas de outro remédio
      const vigente = await save(f.admin, draft(f, { date: "15/10/2026", validity: "180" })); // a primeira vigente já substitui a vencida do mesmo remédio
      expect((await rxRow(vencida))).toMatchObject({ status: "superseded", superseded_by_id: vigente });
      const nova = await save(f.admin, draft(f, { date: "19/10/2026", validity: "30" })); // vigente não é substituída por outra vigente
      expect((await rxRow(vencidaOutro))["status"]).toBe("valid"); // gravada como valid; a tela calcula "vencida"
      expect((await rxRow(vencidaOutro))["superseded_by_id"]).toBeNull();
      expect((await rxRow(vigente))["status"]).toBe("valid");
      expect((await admin`select meta from audit_log where family_id = ${f.familyId} and action = 'rx.superseded'`).length).toBe(1);
      // a tela mostra o encadeamento e a situação calculada pelo domínio
      const snap = await buildSnapshot(ctxOf(f.admin), NOON);
      const por = new Map(snap.prescriptions.map((p) => [p.id, p]));
      expect(por.get(vencida)!.status.kind).toBe("superseded");
      expect(por.get(vencida)!.nextId).toBe(vigente);
      expect(por.get(vigente)!.previousId).toBe(vencida);
      expect(por.get(nova)!.status.kind).toBe("valid");
      expect(por.get(vencidaOutro)!.status.kind).toBe("expired");
      expect(por.get(vigente)!.status.kind).toBe("valid");
    });

    it("'substitui esta' (replacesId) marca a antiga mesmo vigente; só do mesmo paciente", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Repl");
      const antiga = await save(f.admin, draft(f, { date: "15/10/2026", validity: "180" }));
      const nova = await save(f.admin, draft(f, { replacesId: antiga }));
      expect(await rxRow(antiga)).toMatchObject({ status: "superseded", superseded_by_id: nova });
    });

    it("a situação por remédio: vigente, vence em breve, vencida, sem receita e sem exigência", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Estados");
      const otc = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Vitamina", alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: false });
      const link = async () => {
        const s1 = await buildSnapshot(ctxOf(f.admin), NOON);
        return { med: s1.medications.find((m) => m.id === f.medId)!.rx, otc: s1.medications.find((m) => m.id === otc)!.rx };
      };
      expect((await link()).med).toMatchObject({ kind: "none", alert: true, text: "Sem receita anexada" });
      expect((await link()).otc).toMatchObject({ kind: "otc", alert: false });
      const exp = await save(f.admin, draft(f, { date: "01/08/2026", validity: "30" }));
      expect((await link()).med).toMatchObject({ kind: "expired", alert: true, text: "Sem receita vigente: pedir ao médico", rxId: exp });
      const soon = await save(f.admin, draft(f, { date: "25/09/2026", validity: "30" })); // vence em 25/10: faltam 6 dias
      expect((await link()).med).toMatchObject({ kind: "soon", text: "Receita vence em 6 dias", rxId: soon });
      await save(f.admin, draft(f, { date: "19/10/2026", validity: "180" }));
      expect((await link()).med).toMatchObject({ kind: "ok", text: "Receita vigente" });
    });
  });

  describe("permissões recusadas no servidor", () => {
    it("cada perfil só faz o que a permissão deixa; nenhuma chamada toca o armazenamento ou o banco antes de recusar", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Perm");
      const id = await save(f.admin, draft(f));
      const confirmador = await membro(f.familyId, "Confirmador", "Confirmador");
      const cuidadora = await membro(f.familyId, "Cuidadora", "Cuidadora"); // só vê receitas
      const familiar = await membro(f.familyId, "Familiar", "Familiar"); // vê, anexa e compartilha; não exclui

      const n = store.files.size;
      await expect(save(confirmador, draft(f))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(save(cuidadora, draft(f))).rejects.toBeInstanceOf(ForbiddenError);
      expect(store.files.size).toBe(n);
      await expect(rx.deleteRx(cuidadora, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rx.deleteRx(familiar, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rx.restoreRx(familiar, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rx.markSuperseded(cuidadora, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rx.shareRx(cuidadora, id, [familiar.memberId])).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rx.recordView(confirmador, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(rx.authorizeFile(confirmador, randomUUID(), "full")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(repl.claim(cuidadora, f.medId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(repl.completeStep(confirmador, f.medId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(repl.cancel(cuidadora, f.medId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(repl.openManually(cuidadora, f.medId)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await rxRow(id))["deleted_at"]).toBeNull();

      // quem não pode ver receitas não recebe receita, páginas nem a lista de pessoas no retrato
      const semRx = await buildSnapshot(ctxOf(confirmador), NOON);
      expect(semRx.prescriptions).toEqual([]);
      expect(semRx.rxAudience).toEqual([]);
      const comRx = await buildSnapshot(ctxOf(cuidadora), NOON);
      expect(comRx.prescriptions).toHaveLength(1);
      expect(comRx.prescriptions[0]!.pageUrls).toHaveLength(1);
      expect(comRx.prescriptions[0]!.pageUrls![0]!.thumb).toContain(encodeURIComponent(cuidadora.memberId)); // URL presa à pessoa
    });
  });

  describe("excluir (lógico), ver e compartilhar", () => {
    it("excluir esconde a receita e bloqueia a entrega das páginas; desfazer devolve; o arquivo continua no bucket", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Exclui");
      const id = await save(f.admin, draft(f));
      const [file] = await admin`select id from prescription_files where prescription_id = ${id}`;
      expect(await rx.authorizeFile(f.admin, file!["id"] as string, "full")).toMatchObject({ mime: "image/jpeg" });
      await rx.deleteRx(f.admin, id, NOON);
      expect((await rxRow(id))["deleted_at"]).not.toBeNull();
      expect(await rx.authorizeFile(f.admin, file!["id"] as string, "full")).toBeNull();
      expect((await buildSnapshot(ctxOf(f.admin), NOON)).prescriptions).toEqual([]);
      await rx.deleteRx(f.admin, id, NOON); // repetir é inofensivo
      await rx.restoreRx(f.admin, id);
      expect((await buildSnapshot(ctxOf(f.admin), NOON)).prescriptions).toHaveLength(1);
      expect(store.files.size).toBe(1);
      expect((await admin`select action from audit_log where family_id = ${f.familyId} and entity = 'prescription' order by at`).map((a) => a["action"])).toEqual(expect.arrayContaining(["rx.attached", "rx.deleted", "rx.restored"]));
    });

    it("abrir a página inteira fica na auditoria; a miniatura não; arquivo de outra família não é entregue", async () => {
      store = new FakeStorage();
      const a = await novaFamilia("EntregaA");
      const b = await novaFamilia("EntregaB");
      const id = await save(a.admin, draft(a));
      const [file] = await admin`select id from prescription_files where prescription_id = ${id}`;
      await rx.authorizeFile(a.admin, file!["id"] as string, "thumb");
      expect((await admin`select count(*)::int as n from audit_log where family_id = ${a.familyId} and action = 'rx.file_opened'`)[0]!["n"]).toBe(0);
      await rx.authorizeFile(a.admin, file!["id"] as string, "full");
      const [log] = await admin`select meta, entity_id from audit_log where family_id = ${a.familyId} and action = 'rx.file_opened'`;
      expect(log!["entity_id"]).toBe(file!["id"]);
      expect(await rx.authorizeFile(b.admin, file!["id"] as string, "full")).toBeNull(); // RLS: a família B nem enxerga a página
    });

    it("compartilhar dentro do portal: só com quem tem permissão de ver; registra quem viu e a receita aparece como 'compartilhada com você'", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Compart");
      const id = await save(f.admin, draft(f));
      const familiar = await membro(f.familyId, "Familiar", "Filha");
      const confirmador = await membro(f.familyId, "Confirmador", "Neto");
      const convidado = await membro(f.familyId, "Familiar", "Convidada", { accessState: "invited", email: `zz-test-${randomUUID().slice(0, 6)}@exemplo.test` });

      await expect(rx.shareRx(f.admin, id, [confirmador.memberId])).rejects.toThrow(/não tem permissão para ver receitas/);
      await expect(rx.shareRx(f.admin, id, [convidado.memberId])).rejects.toThrow(/ainda não tem acesso/);
      await expect(rx.shareRx(f.admin, id, [f.admin.memberId])).rejects.toThrow(/Escolha com quem/);
      await expect(rx.shareRx(f.admin, id, [randomUUID()])).rejects.toThrow(/não encontrada/);
      expect((await admin`select count(*)::int as n from prescription_shares where prescription_id = ${id}`)[0]!["n"]).toBe(0);

      await rx.shareRx(f.admin, id, [familiar.memberId], NOON);
      const [sh] = await admin`select channel, target_member_id, shared_by_member_id from prescription_shares where prescription_id = ${id}`;
      expect(sh).toMatchObject({ channel: "internal", target_member_id: familiar.memberId, shared_by_member_id: f.admin.memberId });

      const antes = (await buildSnapshot(ctxOf(familiar), NOON)).prescriptions[0]!;
      expect(antes.sharedWithMe).toMatchObject({ by: "Admin" });
      expect((await buildSnapshot(ctxOf(f.admin), NOON)).prescriptions[0]!.shares).toEqual([expect.objectContaining({ to: "Filha", channel: "MedCuidar" })]);

      await rx.recordView(familiar, id, new Date(NOON.getTime() + 60_000));
      await rx.recordView(familiar, id, new Date(NOON.getTime() + 90_000)); // dentro de 5 minutos: não repete
      expect((await admin`select count(*)::int as n from prescription_views where prescription_id = ${id}`)[0]!["n"]).toBe(1);
      await rx.recordView(familiar, id, new Date(NOON.getTime() + 20 * 60_000));
      expect((await admin`select count(*)::int as n from prescription_views where prescription_id = ${id}`)[0]!["n"]).toBe(2);

      const depois = await buildSnapshot(ctxOf(f.admin), new Date(NOON.getTime() + 30 * 60_000));
      expect(depois.prescriptions[0]!.views.map((v) => v.who)).toEqual(["Filha"]);
      expect(depois.prescriptions[0]!.notViewed).not.toContain("Filha");
      expect(depois.prescriptions[0]!.cannotView).toEqual(["Neto"]);
      expect((await buildSnapshot(ctxOf(familiar), new Date(NOON.getTime() + 30 * 60_000))).prescriptions[0]!.sharedWithMe).toBeUndefined();
    });
  });

  describe("avisos de validade", () => {
    it("avisa em 15, 7, 3 e 0 dias (e depois de vencida), uma vez por limite e por pessoa, só para quem pode ver e cuidar da receita", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Avisos");
      await save(f.admin, draft(f, { date: "01/10/2026", validity: "30" })); // vale até 31/10
      const familiar = await membro(f.familyId, "Familiar", "Filha");
      await membro(f.familyId, "Cuidadora", "Cuidadora"); // vê, mas não anexa nem repõe: não recebe
      await membro(f.familyId, "Confirmador", "Neto");
      const rodar = (ymd: string) => rx.evaluateRxExpiryForFamily(f.familyId, TZ, at(ymd));

      expect(await rodar("2026-10-15")).toBe(0); // faltam 16 dias
      expect(await rodar("2026-10-16")).toBe(2); // 15 dias: admin e familiar
      expect(await rodar("2026-10-16")).toBe(0); // repetir não duplica
      expect(await rodar("2026-10-20")).toBe(0); // 11 dias, ainda no limite de 15
      expect(await rodar("2026-10-24")).toBe(2); // 7 dias
      expect(await rodar("2026-10-28")).toBe(2); // 3 dias
      expect(await rodar("2026-10-31")).toBe(2); // vence hoje
      expect(await rodar("2026-10-31")).toBe(0);
      expect(await rodar("2026-11-02")).toBe(0); // vencida há 2 dias: já usou o limite 0
      const n = await noticesOf(f, "prescription_expiring");
      expect(n).toHaveLength(8);
      expect(new Set(n.map((x) => x.member_id))).toEqual(new Set([f.admin.memberId, familiar.memberId]));
      expect(new Set(n.map((x) => x.dedupe_key)).size).toBe(8);
      expect(n.map((x) => x.title)).toEqual(expect.arrayContaining([expect.stringContaining("vence em 15 dias"), expect.stringContaining("vence em 7 dias"), expect.stringContaining("vence em 3 dias"), expect.stringContaining("vence hoje")]));
      // o sino da pessoa leva à receita
      const meus = await listNotices(familiar, at("2026-11-02"));
      expect(meus.notices.find((x) => x.kind === "prescription_expiring")!.href).toMatch(/^\/receitas\/[0-9a-f-]{36}$/);
    });

    it("não avisa de receita substituída, excluída, sem validade nem de remédio que não exige receita", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("AvisosNao");
      const a = await save(f.admin, draft(f, { date: "01/10/2026", validity: "30" }));
      await save(f.admin, draft(f, { date: "05/10/2026", validity: "none" })); // vigente sem validade: cobre o remédio
      await rx.deleteRx(f.admin, a, NOON);
      expect(await rx.evaluateRxExpiryForFamily(f.familyId, TZ, at("2026-10-28"))).toBe(0);
    });
  });

  describe("reposição", () => {
    it("abre sozinha quando o estoque cruza o limite (uma só, mesmo repetindo) e remédio sem receita nasce sem as etapas 1 e 2", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Abre");
      const otc = await meds.createMedication(f.admin, { patientId: f.patientId, name: "Vitamina", alternatives: [], route: "tablet", controlUnit: "unit", requiresPrescription: false, initialStock: 60 });
      // o cadastro usa o dia REAL como início do tratamento; o teste avalia em NOON (fixo): alinha o início para o teste não depender do dia em que roda
      await admin`update treatments set start_date = '2026-10-01' where family_id = ${f.familyId}`;
      expect(await openRepl(f)).toHaveLength(0);
      await lowStock(f);
      await adjustStock(f.admin, otc, 2, "conferi", NOON);
      await evaluateLowStockForFamily(f.familyId, NOON);
      await evaluateLowStockForFamily(f.familyId, NOON);
      const abertas = await openRepl(f);
      expect(abertas).toHaveLength(2);
      const com = abertas.find((r) => r["medication_id"] === f.medId)!;
      const sem = abertas.find((r) => r["medication_id"] === otc)!;
      expect((await stepsOf(com["id"] as string)).map((x) => x["not_applicable"])).toEqual([false, false, false, false]);
      expect((await stepsOf(sem["id"] as string)).map((x) => x["not_applicable"])).toEqual([true, true, false, false]);
      expect(com["triggered_by"]).toBe("low_stock");
      // o retrato mostra a etapa atual de cada uma
      const snap = await buildSnapshot(ctxOf(f.admin), NOON);
      expect(snap.medications.find((m) => m.id === f.medId)!.replenishment).toMatchObject({ step: 0, done: false, stepText: "etapa 1 de 4 · pedir receita ao médico", ownerText: "Ninguém assumiu ainda" });
      expect(snap.medications.find((m) => m.id === otc)!.replenishment).toMatchObject({ step: 2, stepText: "etapa 3 de 4 · comprado" });
      expect(snap.medications.find((m) => m.id === otc)!.replenishment.steps.map((x) => x.kind)).toEqual(["skip", "skip", "cur", "todo"]);
    });

    it("duas pessoas não ficam na mesma etapa: quem chega depois é recusado, a menos que use 'Assumir no lugar'", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Assume");
      await lowStock(f);
      const ana = await membro(f.familyId, "Familiar", "Ana");
      const bia = await membro(f.familyId, "Familiar", "Bia");
      const corrida = await Promise.allSettled([repl.claim(ana, f.medId, {}, NOON), repl.claim(bia, f.medId, {}, NOON)]);
      expect(corrida.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const perdeu = corrida.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(perdeu.reason).toBeInstanceOf(UserError);
      expect(String((perdeu.reason as Error).message)).toMatch(/já assumiu esta etapa.*Assumir no lugar/);
      const [r] = await openRepl(f);
      const dono = (await stepsOf(r!["id"] as string))[0]!["owner_member_id"];
      const [vencedor, outro] = dono === ana.memberId ? [ana, bia] : [bia, ana];
      expect(dono).toBe(vencedor.memberId);
      await repl.claim(vencedor, f.medId, {}, NOON); // repetir o próprio "Eu cuido disso" não muda nada
      await repl.claim(outro, f.medId, { takeOver: true }, new Date(NOON.getTime() + 60_000));
      const passo = (await stepsOf(r!["id"] as string))[0]!;
      expect(passo["owner_member_id"]).toBe(outro.memberId);
      expect(passo["claimed_at"]).not.toBeNull();
      // só o dono conclui a etapa
      await expect(repl.completeStep(vencedor, f.medId, {}, NOON)).rejects.toThrow(/Outra pessoa assumiu/);
      await repl.completeStep(outro, f.medId, {}, NOON);
      expect((await stepsOf(r!["id"] as string))[0]!["done_at"]).not.toBeNull();
      // cada mudança avisa os OUTROS que cuidam da reposição (não quem fez)
      const avisos = await noticesOf(f, "replenishment_update");
      expect(avisos.some((a) => a.member_id === outro.memberId && a.title.includes("Etapa concluída"))).toBe(false);
      expect(avisos.some((a) => a.member_id === vencedor.memberId && a.title.includes("Etapa concluída"))).toBe(true);
      expect(avisos.some((a) => a.member_id === f.admin.memberId && /vai pedir a receita/.test(a.title))).toBe(true);
    });

    it("anexar a receita recebida avança as etapas 1 e 2; o pedido ao médico deixa a receita atual 'aguardando nova' até a nova chegar", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Recebe");
      const antiga = await save(f.admin, draft(f, { date: "15/10/2026", validity: "180" })); // vigente
      await lowStock(f);
      const ana = await membro(f.familyId, "Familiar", "Ana");
      await repl.claim(ana, f.medId, {}, NOON);
      await repl.completeStep(ana, f.medId, {}, NOON); // "Pedir receita ao médico" feito
      const [r] = await openRepl(f);
      expect(r!["status"]).toBe("needs_prescription");
      let snap = await buildSnapshot(ctxOf(f.admin), NOON);
      expect(snap.prescriptions.find((p) => p.id === antiga)!.status.kind).toBe("awaiting_new");
      expect(snap.medications.find((m) => m.id === f.medId)!.replenishment).toMatchObject({ needsAttach: true, advanceLabel: "Anexar receita recebida" });
      // sem receita nova, "marcar como feito" na etapa 2 pede para anexar... mas a antiga ainda é 'valid' no banco: o domínio manda a nova
      const nova = await save(ana, draft(f, { date: "19/10/2026", validity: "180" }));
      expect((await rxRow(antiga))).toMatchObject({ status: "superseded", superseded_by_id: nova }); // 'aguardando nova' foi substituída
      const [depois] = await openRepl(f);
      expect(depois!["status"]).toBe("prescription_received");
      const passos = await stepsOf(depois!["id"] as string);
      expect(passos[0]!["done_at"]).not.toBeNull();
      expect(passos[1]).toMatchObject({ prescription_id: nova });
      expect(passos[1]!["done_at"]).not.toBeNull();
      snap = await buildSnapshot(ctxOf(f.admin), NOON);
      expect(snap.medications.find((m) => m.id === f.medId)!.replenishment).toMatchObject({ stepText: "etapa 3 de 4 · comprado", needsQuantity: true });
      expect(snap.medications.find((m) => m.id === f.medId)!.rx).toMatchObject({ kind: "ok" });
      expect((await noticesOf(f, "replenishment_update")).some((a) => a.title.startsWith("Receita recebida"))).toBe(true);
    });

    it("a etapa 'receita recebida' não conclui sem receita vigente", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("SemRx");
      await lowStock(f);
      await repl.completeStep(f.admin, f.medId, {}, NOON); // etapa 1 (pedir ao médico): ninguém assumiu, quem conclui assume
      await expect(repl.completeStep(f.admin, f.medId, {}, NOON)).rejects.toThrow(/Anexe a receita recebida/);
    });

    it("registrar a compra soma ao estoque UMA vez (mesmo com envio duplo), liga o movimento à reposição e encerra", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Compra", { requires: false });
      await lowStock(f);
      const antes = await balance(f);
      const [r] = await openRepl(f);
      await expect(repl.completeStep(f.admin, f.medId, {}, NOON)).rejects.toThrow(/quantidade comprada/);
      await expect(repl.completeStep(f.admin, f.medId, { quantity: 0 }, NOON)).rejects.toThrow(/quantidade comprada/);
      const duplo = await Promise.allSettled([repl.completeStep(f.admin, f.medId, { quantity: 40 }, NOON), repl.completeStep(f.admin, f.medId, { quantity: 40 }, NOON)]);
      expect(duplo.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(String(((duplo.find((x) => x.status === "rejected") as PromiseRejectedResult).reason as Error).message)).toMatch(/encerrada|Não há reposição/);
      expect(await balance(f)).toBe(antes + 40);
      const movs = await admin`select type, quantity, replenishment_id from stock_movements where replenishment_id = ${r!["id"] as string}`;
      expect(movs).toHaveLength(1);
      expect(movs[0]).toMatchObject({ type: "purchase", quantity: 40 });
      const [fim] = await admin`select status, closed_at from replenishments where id = ${r!["id"] as string}`;
      expect(fim!["status"]).toBe("done");
      expect(fim!["closed_at"]).not.toBeNull();
      expect((await stepsOf(r!["id"] as string)).map((x) => x["done_at"] !== null || x["not_applicable"] === true)).toEqual([true, true, true, true]);
      // o banco também garante: uma segunda compra ligada à mesma reposição é recusada
      const [item] = await admin`select id from stock_items where family_id = ${f.familyId}`;
      await expect(admin`insert into stock_movements (family_id, stock_item_id, type, quantity, replenishment_id) values (${f.familyId}, ${item!["id"] as string}, 'purchase', 5, ${r!["id"] as string})`).rejects.toThrow(/duplicate|unique|único/i);
      // o estoque subiu: não reabre
      expect(await openRepl(f)).toHaveLength(0);
    });

    it("registrar compra pelo Estoque, com a reposição esperando a compra, fecha a reposição sem duplicar o movimento", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("CompraEstoque", { requires: false });
      await lowStock(f);
      const antes = await balance(f);
      await registerPurchase(f.admin, f.medId, 25, "farmácia", NOON);
      expect(await balance(f)).toBe(antes + 25);
      expect((await admin`select count(*)::int as n from stock_movements where family_id = ${f.familyId} and type = 'purchase' and replenishment_id is not null`)[0]!["n"]).toBe(1);
      expect((await admin`select count(*)::int as n from stock_movements where family_id = ${f.familyId} and type = 'purchase' and note = 'Compra: farmácia'`)[0]!["n"]).toBe(0);
      expect(await openRepl(f)).toHaveLength(0);
    });

    it("compra comum com a reposição ainda esperando a receita não mexe na reposição", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("CompraComum");
      await lowStock(f);
      await registerPurchase(f.admin, f.medId, 25, undefined, NOON);
      const [r] = await openRepl(f);
      expect(r!["status"]).toBe("needs_prescription");
      expect((await admin`select count(*)::int as n from stock_movements where replenishment_id = ${r!["id"] as string}`)[0]!["n"]).toBe(0);
    });

    it("iniciar à mão, cancelar e reabrir sozinha se o estoque continuar baixo", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Cancela");
      await repl.openManually(f.admin, f.medId, NOON);
      const [r] = await openRepl(f);
      expect(r!["triggered_by"]).toBe("manual");
      await repl.openManually(f.admin, f.medId, NOON); // já aberta: nada muda
      expect(await openRepl(f)).toHaveLength(1);
      await repl.cancel(f.admin, f.medId, NOON);
      expect(await openRepl(f)).toHaveLength(0);
      await expect(repl.cancel(f.admin, f.medId, NOON)).rejects.toThrow(/Não há reposição aberta/);
      await lowStock(f);
      expect(await openRepl(f)).toHaveLength(1); // estoque baixo: abre outra, a anterior fica cancelada
      expect((await admin`select count(*)::int as n from replenishments where family_id = ${f.familyId}`)[0]!["n"]).toBe(2);
    });

    it("o histórico de doses ganha os eventos de receita e reposição (sem texto clínico), com os filtros", async () => {
      store = new FakeStorage();
      const f = await novaFamilia("Hist");
      await save(f.admin, draft(f));
      await lowStock(f);
      await repl.claim(f.admin, f.medId, {}, NOON);
      const h = await listDoseHistory(f.admin, {}, new Date());
      const titulos = (h.events ?? []).map((e) => e.title);
      expect(titulos).toEqual(expect.arrayContaining(["Receita anexada", "Assumiu a reposição"]));
      expect(JSON.stringify(h.events)).not.toMatch(/Helena|Pingar/);
      expect((await listDoseHistory(f.admin, { medicationId: randomUUID() }, new Date())).events).toEqual([]);
      expect((await listDoseHistory(f.admin, { status: "taken" }, new Date())).events).toEqual([]);
      const semRx = await membro(f.familyId, "Cuidadora", "Cuidadora");
      // Cuidadora vê receitas e o histórico: vê os dois tipos; Confirmador nem chega ao histórico
      expect(((await listDoseHistory(semRx, {}, new Date())).events ?? []).length).toBeGreaterThan(0);
      const sem = { ...semRx, member: { ...semRx.member, permissions: { ...semRx.member.permissions, "prescriptions.view": false } } };
      expect(((await listDoseHistory(sem, {}, new Date())).events ?? []).map((e) => e.kind)).not.toContain("prescription");
    });
  });

  describe("RLS entre famílias nas tabelas de receita e reposição", () => {
    it("outra família não lê, altera, apaga nem grava em receitas, páginas, itens, compartilhamentos, visualizações, reposições e etapas", async () => {
      store = new FakeStorage();
      const a = await novaFamilia("RlsA");
      const b = await novaFamilia("RlsB");
      const filha = await membro(a.familyId, "Familiar", "Filha");
      const id = await save(a.admin, draft(a));
      await rx.shareRx(a.admin, id, [filha.memberId], NOON);
      await rx.recordView(filha, id, NOON);
      await lowStock(a);
      await repl.claim(a.admin, a.medId, {}, NOON);
      expect(await openRepl(a)).toHaveLength(1);

      const tabelas = [s.prescriptions, s.prescriptionFiles, s.prescriptionItems, s.prescriptionShares, s.prescriptionViews, s.replenishments, s.replenishmentSteps] as const;
      for (const t of tabelas) {
        const vistas = await withFamilia(b.familyId, (tx) => tx.select({ familyId: t.familyId }).from(t));
        expect(vistas.every((r) => r.familyId === b.familyId)).toBe(true);
        const doA = await withFamilia(a.familyId, (tx) => tx.select({ familyId: t.familyId }).from(t));
        expect(doA.length).toBeGreaterThan(0);
      }
      const upd = await withFamilia(b.familyId, (tx) => tx.update(s.prescriptions).set({ notes: "invadida" }).where(eq(s.prescriptions.id, id)).returning());
      expect(upd).toHaveLength(0);
      const del = await withFamilia(b.familyId, (tx) => tx.delete(s.prescriptionFiles).where(eq(s.prescriptionFiles.prescriptionId, id)).returning());
      expect(del).toHaveLength(0);
      const stepUpd = await withFamilia(b.familyId, (tx) => tx.update(s.replenishmentSteps).set({ ownerMemberId: b.admin.memberId }).where(eq(s.replenishmentSteps.familyId, a.familyId)).returning());
      expect(stepUpd).toHaveLength(0);
      await expect(withFamilia(b.familyId, (tx) => tx.insert(s.prescriptionViews).values({ familyId: a.familyId, prescriptionId: id, memberId: filha.memberId }))).rejects.toThrow();
      await expect(withFamilia(b.familyId, (tx) => tx.insert(s.replenishments).values({ familyId: a.familyId, patientId: a.patientId, medicationId: a.medId, triggeredBy: "manual" }))).rejects.toThrow();
      // a receita da A segue intacta
      expect((await rxRow(id))["notes"]).toBe("Pingar à noite");
      expect((await admin`select count(*)::int as n from prescription_files where prescription_id = ${id}`)[0]!["n"]).toBe(1);
      // e a B não consegue agir sobre a receita ou a reposição da A pelo servidor
      await expect(rx.deleteRx(b.admin, id, NOON)).rejects.toThrow(/não encontrada/);
      await expect(rx.shareRx(b.admin, id, [b.admin.memberId])).rejects.toBeInstanceOf(UserError);
      await expect(rx.saveRx(b.admin, draft(b, { editId: id }), [], { storage: store, now: NOON })).rejects.toThrow(/não encontrada/);
      expect((await buildSnapshot(ctxOf(b.admin), NOON)).prescriptions).toEqual([]);
    });
  });
});
