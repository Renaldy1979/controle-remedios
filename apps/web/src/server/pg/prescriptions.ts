import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, notInArray } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts, medicationPrescriptionState, prescriptionsToSupersede, validUntilFromDays, type PrescriptionRef } from "@medcuidar/domain";
import { can, permissionMapSchema } from "@medcuidar/shared";
import { audit } from "./audit";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";
import { membersMatching } from "./recipients";
import { onPrescriptionReceived } from "./replenishment";
import { rxInfo, rxRef, type PendingRequest, type RxRow } from "./rx-state";
import { MAX_FILES, MAX_FILE_BYTES, rxStorage, type RxStorage } from "./rx-storage";

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;
const VALIDITY_DAYS: Record<string, number | null> = { "30": 30, "60": 60, "180": 180, none: null };

export interface RxDraftInput {
  patientId: string;
  /** dd/mm/aaaa */
  date: string;
  doctor: string;
  specialty: string;
  medicationIds: string[];
  validity: "30" | "60" | "180" | "none";
  notes: string;
  controlled?: boolean | undefined;
  copies?: number | undefined;
  /** receita antiga que esta nova substitui (além das que o domínio já substitui sozinho) */
  replacesId?: string | null | undefined;
  /** edita os dados de uma receita já salva (as páginas não mudam) */
  editId?: string | null | undefined;
}

export interface RxFileInput {
  bytes: Buffer;
}

/** dd/mm/aaaa → aaaa-mm-dd, ou null se não for uma data real. */
export function parseBrDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 ? d.toISOString().slice(0, 10) : null;
}

/** Tipo de arquivo pelos primeiros bytes (não confia no que o navegador disse): JPG, PNG, WEBP, HEIC ou PDF. */
export function sniffMime(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(b.toString("latin1", 8, 12))) return "image/heic";
  return null;
}

/** Dados da receita validados, com a data e a validade calculadas. */
function checkDraft(draft: RxDraftInput, today: string): { issued: string; validUntil: string | null } {
  const issued = parseBrDate(draft.date);
  if (!issued || issued > today) throw new UserError("Use a data da receita no formato dd/mm/aaaa, de hoje ou anterior.");
  if (issued < "1990-01-01") throw new UserError("Confira a data da receita.");
  if (draft.medicationIds.length === 0) throw new UserError("Escolha pelo menos um remédio desta receita.");
  const days = VALIDITY_DAYS[draft.validity] ?? null;
  return { issued, validUntil: days === null ? null : validUntilFromDays(issued, days) };
}

/** O paciente e os remédios são da família (RLS), estão vivos e o paciente toma cada remédio. */
async function checkSubjects(tx: Tx, patientId: string, medicationIds: string[]): Promise<void> {
  const [patient] = await tx.select({ id: s.patients.id }).from(s.patients).where(and(eq(s.patients.id, patientId), isNull(s.patients.deletedAt)));
  if (!patient) throw new UserError("Paciente não encontrado.");
  const ids = [...new Set(medicationIds)];
  const rows = await tx
    .select({ id: s.treatments.medicationId })
    .from(s.treatments)
    .innerJoin(s.medications, and(eq(s.medications.id, s.treatments.medicationId), isNull(s.medications.deletedAt)))
    .where(and(eq(s.treatments.patientId, patientId), inArray(s.treatments.medicationId, ids), isNull(s.treatments.deletedAt)));
  if (rows.length !== ids.length) throw new UserError("Escolha só remédios deste paciente.");
}

/** Pedidos de receita em andamento (reposição aberta com a etapa 1 feita e a 2 não). */
export async function pendingRequests(tx: Tx): Promise<PendingRequest[]> {
  const rows = await tx
    .select({ patientId: s.replenishments.patientId, medicationId: s.replenishments.medicationId })
    .from(s.replenishments)
    .innerJoin(s.replenishmentSteps, and(eq(s.replenishmentSteps.replenishmentId, s.replenishments.id), eq(s.replenishmentSteps.step, 1)))
    .where(and(eq(s.replenishments.status, "needs_prescription"), eq(s.replenishmentSteps.notApplicable, false), isNotNull(s.replenishmentSteps.doneAt)));
  return rows;
}

const rowOf = (r: typeof s.prescriptions.$inferSelect): RxRow => ({
  id: r.id, patientId: r.patientId, issuedOn: r.issuedOn, validUntil: r.validUntil, status: r.status, supersededById: r.supersededById,
});

/* ------------------------------------------------------------------ anexar e editar */

/**
 * Salva uma receita nova (com as páginas) ou edita os dados de uma existente. As páginas vão para o bucket privado do
 * Appwrite com nome neutro; se algo falhar depois do envio, as páginas enviadas são apagadas. Ao salvar uma nova, as
 * receitas vencidas ou "aguardando nova" do mesmo paciente com remédio em comum viram "substituídas" e as reposições
 * abertas desses remédios avançam para "receita recebida".
 */
export async function saveRx(actor: Actor, draft: RxDraftInput, files: RxFileInput[], opts: { storage?: RxStorage; now?: Date } = {}): Promise<string> {
  requirePermission(actor, "prescriptions.upload");
  const now = opts.now ?? new Date();
  const today = localParts(now, actor.timezone).date;
  const { issued, validUntil } = checkDraft(draft, today);
  const notes = draft.notes.trim().slice(0, 1000) || null;
  const doctor = draft.doctor.trim().slice(0, 120) || null;
  const specialty = draft.specialty.trim().slice(0, 80) || null;
  const copies = draft.controlled ? Math.min(9, Math.max(1, Math.trunc(draft.copies ?? 1))) : null;

  if (draft.editId) {
    const editId = draft.editId;
    await withFamilia(actor.familyId, async (tx) => {
      const [rx] = await tx.select().from(s.prescriptions).where(and(eq(s.prescriptions.id, editId), isNull(s.prescriptions.deletedAt)));
      if (!rx) throw new UserError("Receita não encontrada.");
      await checkSubjects(tx, draft.patientId, draft.medicationIds);
      await tx.update(s.prescriptions).set({ patientId: draft.patientId, issuedOn: issued, validUntil, doctorName: doctor, specialty, isControlled: !!draft.controlled, copies, notes }).where(eq(s.prescriptions.id, editId));
      const have = await tx.select().from(s.prescriptionItems).where(eq(s.prescriptionItems.prescriptionId, editId));
      const keep = new Set(draft.medicationIds);
      const drop = have.filter((i) => !keep.has(i.medicationId)).map((i) => i.id);
      if (drop.length) await tx.delete(s.prescriptionItems).where(inArray(s.prescriptionItems.id, drop));
      const add = [...keep].filter((m) => !have.some((i) => i.medicationId === m));
      if (add.length) await tx.insert(s.prescriptionItems).values(add.map((m) => ({ familyId: actor.familyId, prescriptionId: editId, medicationId: m })));
      await audit(tx, actor, "rx.edited", "prescription", editId, { patientId: draft.patientId, medicationIds: draft.medicationIds });
    });
    return editId;
  }

  if (files.length === 0) throw new UserError("Adicione pelo menos uma página da receita.");
  if (files.length > MAX_FILES) throw new UserError(`No máximo ${MAX_FILES} páginas por receita.`);
  const typed = files.map((f) => {
    if (f.bytes.length > MAX_FILE_BYTES) throw new UserError("Cada página pode ter até 15 MB.");
    const mime = sniffMime(f.bytes);
    if (!mime) throw new UserError("Use fotos (JPG, PNG, WEBP, HEIC) ou PDF.");
    return { bytes: f.bytes, mime };
  });

  const storage = opts.storage ?? rxStorage();
  const uploaded: Array<{ storageFileId: string; page: number; mime: string; size: number }> = [];
  try {
    let page = 1;
    for (const f of typed) uploaded.push({ storageFileId: await storage.put(f.bytes, f.mime, page), page: page++, mime: f.mime, size: f.bytes.length });
    return await withFamilia(actor.familyId, async (tx) => {
      await checkSubjects(tx, draft.patientId, draft.medicationIds);
      const medIds = [...new Set(draft.medicationIds)];
      const [rx] = await tx
        .insert(s.prescriptions)
        .values({ familyId: actor.familyId, patientId: draft.patientId, doctorName: doctor, specialty, issuedOn: issued, validUntil, isControlled: !!draft.controlled, copies, notes, uploadedByMemberId: actor.memberId })
        .returning();
      await tx.insert(s.prescriptionItems).values(medIds.map((m) => ({ familyId: actor.familyId, prescriptionId: rx!.id, medicationId: m })));
      await tx.insert(s.prescriptionFiles).values(uploaded.map((u) => ({ familyId: actor.familyId, prescriptionId: rx!.id, storageFileId: u.storageFileId, page: u.page, mime: u.mime, size: u.size })));

      // substitui as vencidas/aguardando nova do mesmo paciente com remédio em comum (antes de mexer nas reposições)
      const others = await tx.select().from(s.prescriptions).where(and(eq(s.prescriptions.patientId, draft.patientId), isNull(s.prescriptions.deletedAt)));
      const otherIds = others.filter((o) => o.id !== rx!.id).map((o) => o.id);
      const items = otherIds.length ? await tx.select().from(s.prescriptionItems).where(inArray(s.prescriptionItems.prescriptionId, otherIds)) : [];
      const pending = await pendingRequests(tx);
      const refs: PrescriptionRef[] = others
        .filter((o) => o.id !== rx!.id)
        .map((o) => rxRef(rowOf(o), items.filter((i) => i.prescriptionId === o.id).map((i) => i.medicationId), pending, today));
      const superseded = new Set(prescriptionsToSupersede({ id: rx!.id, patient_id: draft.patientId, medication_ids: medIds }, refs));
      if (draft.replacesId && others.some((o) => o.id === draft.replacesId && o.id !== rx!.id)) superseded.add(draft.replacesId);
      if (superseded.size) await tx.update(s.prescriptions).set({ status: "superseded", supersededById: rx!.id }).where(inArray(s.prescriptions.id, [...superseded]));

      await onPrescriptionReceived(tx, actor, { patientId: draft.patientId, medicationIds: medIds, prescriptionId: rx!.id, now });
      await audit(tx, actor, "rx.attached", "prescription", rx!.id, { patientId: draft.patientId, medicationIds: medIds, pages: uploaded.length });
      if (superseded.size) await audit(tx, actor, "rx.superseded", "prescription", rx!.id, { patientId: draft.patientId, medicationIds: medIds, count: superseded.size });
      return rx!.id;
    });
  } catch (e) {
    for (const u of uploaded) await storage.remove(u.storageFileId).catch(() => undefined);
    throw e;
  }
}

/* ------------------------------------------------------------------ excluir (lógico), substituir, ver, compartilhar */

async function liveRx(tx: Tx, id: string, deleted = false) {
  const [rx] = await tx.select().from(s.prescriptions).where(and(eq(s.prescriptions.id, id), deleted ? undefined : isNull(s.prescriptions.deletedAt)));
  if (!rx) throw new UserError("Receita não encontrada.");
  return rx;
}

const medicationIdsOf = async (tx: Tx, rxId: string) => (await tx.select({ m: s.prescriptionItems.medicationId }).from(s.prescriptionItems).where(eq(s.prescriptionItems.prescriptionId, rxId))).map((r) => r.m);

export async function deleteRx(actor: Actor, id: string, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "prescriptions.delete");
  await withFamilia(actor.familyId, async (tx) => {
    const rx = await liveRx(tx, id, true);
    if (rx.deletedAt) return; // já excluída: idempotente
    await tx.update(s.prescriptions).set({ deletedAt: now }).where(eq(s.prescriptions.id, id));
    await audit(tx, actor, "rx.deleted", "prescription", id, { patientId: rx.patientId });
  });
}

export async function restoreRx(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "prescriptions.delete");
  await withFamilia(actor.familyId, async (tx) => {
    const rx = await liveRx(tx, id, true);
    if (!rx.deletedAt) return;
    await tx.update(s.prescriptions).set({ deletedAt: null }).where(eq(s.prescriptions.id, id));
    await audit(tx, actor, "rx.restored", "prescription", id, { patientId: rx.patientId });
  });
}

/** "Marcar como substituída" à mão. */
export async function markSuperseded(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, "prescriptions.upload");
  await withFamilia(actor.familyId, async (tx) => {
    const rx = await liveRx(tx, id);
    await tx.update(s.prescriptions).set({ status: "superseded" }).where(eq(s.prescriptions.id, id));
    await audit(tx, actor, "rx.superseded", "prescription", id, { patientId: rx.patientId, medicationIds: await medicationIdsOf(tx, id) });
  });
}

const VIEW_THROTTLE_MS = 5 * 60_000;

/** Registro de visualização (quem viu e quando). Uma vez por abertura; abrir de novo em menos de 5 minutos não repete. */
export async function recordView(actor: Actor, id: string, now: Date = new Date()): Promise<void> {
  requirePermission(actor, "prescriptions.view");
  await withFamilia(actor.familyId, async (tx) => {
    await liveRx(tx, id);
    const [last] = await tx
      .select({ at: s.prescriptionViews.viewedAt })
      .from(s.prescriptionViews)
      .where(and(eq(s.prescriptionViews.prescriptionId, id), eq(s.prescriptionViews.memberId, actor.memberId)))
      .orderBy(desc(s.prescriptionViews.viewedAt))
      .limit(1);
    if (last && now.getTime() - last.at.getTime() < VIEW_THROTTLE_MS) return;
    await tx.insert(s.prescriptionViews).values({ familyId: actor.familyId, prescriptionId: id, memberId: actor.memberId, viewedAt: now });
  });
}

/** Compartilhar DENTRO do portal: só com pessoas ativas que têm permissão de ver receitas (o perfil sem permissão é recusado). */
export async function shareRx(actor: Actor, id: string, memberIds: string[], now: Date = new Date()): Promise<void> {
  requirePermission(actor, "prescriptions.view", "prescriptions.share");
  const ids = [...new Set(memberIds)].filter((m) => m !== actor.memberId);
  if (ids.length === 0) throw new UserError("Escolha com quem compartilhar.");
  await withFamilia(actor.familyId, async (tx) => {
    const rx = await liveRx(tx, id);
    const targets = await tx
      .select({ id: s.members.id, name: s.members.name, active: s.members.active, state: s.members.accessState, removedAt: s.members.removedAt, profileName: s.profiles.name, permissions: s.profiles.permissions })
      .from(s.members)
      .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
      .where(inArray(s.members.id, ids));
    if (targets.length !== ids.length) throw new UserError("Pessoa não encontrada.");
    for (const t of targets) {
      const p = permissionMapSchema.safeParse(t.permissions);
      if (!t.active || t.removedAt || t.state !== "active") throw new UserError(`${firstName(t.name)} ainda não tem acesso ao portal.`);
      if (!can({ profileName: t.profileName, permissions: p.success ? p.data : {} }, "prescriptions.view")) throw new UserError(`${firstName(t.name)} não tem permissão para ver receitas.`);
    }
    await tx.insert(s.prescriptionShares).values(ids.map((m) => ({ familyId: actor.familyId, prescriptionId: id, sharedByMemberId: actor.memberId, channel: "internal" as const, targetMemberId: m, sharedAt: now })));
    await audit(tx, actor, "rx.shared", "prescription", id, { patientId: rx.patientId, medicationIds: await medicationIdsOf(tx, id), channel: "internal", targets: ids.length });
  });
}

/**
 * Autoriza a entrega de UMA página (rota `/api/rx-file`): a página precisa ser da família (RLS) e a receita não pode estar
 * excluída. Devolve onde ela está no bucket. A abertura em tamanho inteiro fica na auditoria (`rx.file_opened`).
 */
export async function authorizeFile(actor: Actor, fileId: string, variant: "thumb" | "full"): Promise<{ storageFileId: string; mime: string } | null> {
  requirePermission(actor, "prescriptions.view");
  return withFamilia(actor.familyId, async (tx) => {
    const [f] = await tx
      .select({ storageFileId: s.prescriptionFiles.storageFileId, mime: s.prescriptionFiles.mime, rxId: s.prescriptionFiles.prescriptionId })
      .from(s.prescriptionFiles)
      .innerJoin(s.prescriptions, and(eq(s.prescriptions.id, s.prescriptionFiles.prescriptionId), isNull(s.prescriptions.deletedAt)))
      .where(eq(s.prescriptionFiles.id, fileId));
    if (!f) return null;
    if (variant === "full") await audit(tx, actor, "rx.file_opened", "prescription_file", fileId, { prescriptionId: f.rxId });
    return { storageFileId: f.storageFileId, mime: f.mime };
  });
}

/* ------------------------------------------------------------------ aviso "receita vence em X dias" */

export const EXPIRY_THRESHOLDS = [15, 7, 3, 0] as const;
const EXPIRED_NOTICE_WINDOW_DAYS = 30;

/**
 * Avisos do sino para receitas que vencem (15/7/3/0 dias) ou venceram há pouco, para quem pode ver e cuidar delas.
 * Só avisa pela receita que hoje cobre o remédio (a mais nova); uma por limite, por receita e por pessoa (`dedupe_key`).
 * Devolve quantos avisos novos foram criados.
 */
export async function evaluateRxExpiry(tx: Tx, familyId: string, today: string): Promise<number> {
  const rxs = await tx.select().from(s.prescriptions).where(and(isNull(s.prescriptions.deletedAt), notInArray(s.prescriptions.status, ["superseded"])));
  if (rxs.length === 0) return 0;
  const items = await tx.select().from(s.prescriptionItems).where(inArray(s.prescriptionItems.prescriptionId, rxs.map((r) => r.id)));
  const meds = await tx.select({ id: s.medications.id, name: s.medications.name, requires: s.medications.requiresPrescription }).from(s.medications).where(isNull(s.medications.deletedAt));
  const patients = await tx.select({ id: s.patients.id, name: s.patients.name }).from(s.patients).where(isNull(s.patients.deletedAt));
  const pending = await pendingRequests(tx);
  const medsOf = (rxId: string) => items.filter((i) => i.prescriptionId === rxId).map((i) => i.medicationId);

  const recipients = await membersMatching(tx, (m) => can(m, "prescriptions.view") && (can(m, "prescriptions.upload") || can(m, "replenishment.manage")));
  if (recipients.length === 0) return 0;

  let created = 0;
  for (const p of patients) {
    const mine = rxs.filter((r) => r.patientId === p.id);
    const refs = mine.map((r) => rxRef(rowOf(r), medsOf(r.id), pending, today));
    const current = new Set<string>();
    for (const med of meds) {
      if (!med.requires) continue;
      const { state, prescription } = medicationPrescriptionState(med.id, refs, true);
      if ((state === "valid" || state === "expired") && prescription) current.add(prescription.id);
    }
    for (const rx of mine.filter((r) => current.has(r.id))) {
      const info = rxInfo(rowOf(rx), medsOf(rx.id), pending, today);
      const left = info.expiresInDays;
      if (left === null || !rx.validUntil) continue;
      if (info.status === "expired" ? left < -EXPIRED_NOTICE_WINDOW_DAYS : left > EXPIRY_THRESHOLDS[0]) continue;
      if (info.status !== "valid" && info.status !== "expired") continue;
      const threshold = [...EXPIRY_THRESHOLDS].reverse().find((t) => t >= left) ?? 0;
      const names = medsOf(rx.id).map((m) => meds.find((x) => x.id === m)?.name).filter(Boolean).join(", ");
      const title = left < 0 ? `Receita vencida: ${names} (${firstName(p.name)})` : left === 0 ? `Receita vence hoje: ${names} (${firstName(p.name)})` : `Receita vence em ${left} ${left === 1 ? "dia" : "dias"}: ${names} (${firstName(p.name)})`;
      const rows = await tx
        .insert(s.notifications)
        .values(recipients.map((r) => ({
          familyId, memberId: r.id, kind: "prescription_expiring" as const, title, body: "Peça uma receita nova ao médico para não faltar o remédio.",
          payload: { prescriptionId: rx.id, patientId: p.id, medicationIds: medsOf(rx.id), daysLeft: left, threshold }, dedupeKey: `rx_expiry:${rx.id}:${threshold}:${r.id}`,
        })))
        .onConflictDoNothing({ target: [s.notifications.familyId, s.notifications.dedupeKey] })
        .returning({ id: s.notifications.id });
      created += rows.length;
    }
  }
  return created;
}

export async function evaluateRxExpiryForFamily(familyId: string, tz: string, now: Date = new Date()): Promise<number> {
  const today = localParts(now, tz).date;
  return withFamilia(familyId, (tx) => evaluateRxExpiry(tx, familyId, today));
}
