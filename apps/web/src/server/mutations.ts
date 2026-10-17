import "server-only";
import { normalizePhone } from "@medcuidar/channels";
import { PERMISSION_GROUPS, can, parseJsonField, permissionMapSchema, type MedRoute, type PermissionMap } from "@medcuidar/shared";
import { ID, Permission, Query, Role } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import type { AttachDraft, MedicationPatch, MemberInput, NotificationSettingsVM, SchemeInput, ShareTarget } from "@/data/types";
import { enqueue } from "@medcuidar/functions";
import { clients } from "./clients";
import { type Ctx, requirePermission } from "./context";
import { audit, listAll, num, str, strList, type R } from "./data";
import { PRESCRIPTION_BUCKET } from "./env";
import { services } from "./services";
import { addDaysYmd } from "./snapshot";

/** Erro com mensagem segura para mostrar à pessoa (sem detalhes internos). */
export class UserError extends Error {}

const nowIso = () => new Date().toISOString();
const noon = (ymd: string) => `${ymd}T12:00:00.000Z`;
const ROUTE_BY_LABEL: Record<string, MedRoute> = { Pingar: "drops", Comprimido: "tablet", "Pó dissolvido": "powder", Líquido: "liquid", Pomada: "ointment", Outro: "other" };

// ───────────────────────── helpers ─────────────────────────

async function treatmentForMed(ctx: Ctx, medId: string): Promise<R> {
  const rows = await listAll(ctx.db, "treatments", [Query.equal("medication_id", medId)]);
  const t = rows.find((r) => !r["deleted_at"] && str(r, "status") !== "finished");
  if (!t) throw new UserError("Remédio não encontrado.");
  return t;
}

async function stockItemFor(ctx: Ctx, medId: string): Promise<R> {
  const t = await treatmentForMed(ctx, medId);
  const [item] = await listAll(ctx.db, "stock_items", [Query.equal("patient_id", str(t, "patient_id")), Query.equal("medication_id", medId)]);
  if (!item) throw new UserError("Este remédio ainda não tem estoque registrado.");
  return item;
}

async function openReplenishmentId(ctx: Ctx, medId: string): Promise<{ id: string; patientId: string }> {
  const t = await treatmentForMed(ctx, medId);
  const patientId = str(t, "patient_id");
  const find = async () => (await listAll(ctx.db, "replenishments", [Query.equal("patient_id", patientId), Query.equal("medication_id", medId)])).find((r) => !["done", "cancelled"].includes(str(r, "status")));
  let repl = await find();
  if (!repl) {
    // o domínio abre a reposição quando o estoque cruza o limite
    await services().domain.checkLowStock({ familyId: ctx.familyId, patientId, medicationId: medId });
    repl = await find();
  }
  if (!repl) throw new UserError("Não há reposição aberta para este remédio.");
  return { id: repl.$id, patientId };
}

const medIdsOfRx = async (ctx: Ctx, rxId: string) => (await listAll(ctx.db, "prescription_items", [Query.equal("prescription_id", rxId)])).map((i) => str(i, "medication_id"));

// ───────────────────────── doses ─────────────────────────

export async function confirmDose(ctx: Ctx, doseId: string): Promise<void> {
  requirePermission(ctx, "doses.confirm");
  const { result } = await services().doses.confirm({ familyId: ctx.familyId, doseEventId: doseId, memberId: ctx.member.id, channel: "panel" });
  if (result.outcome === "not_found" || result.outcome === "forbidden") throw new UserError("Dose não encontrada.");
  // already_confirmed / already_taken: idempotente, a dose já está tomada
}

const UNDO_WINDOW_MS = 30_000; // a UI oferece 8 s; o servidor aceita com folga para latência

export async function undoDose(ctx: Ctx, doseId: string): Promise<void> {
  requirePermission(ctx, "doses.confirm");
  const dose = await ctx.db.get("dose_events", doseId);
  const at = dose["confirmed_at"] ? new Date(String(dose["confirmed_at"])).getTime() : 0;
  if (str(dose as R, "status") !== "taken" || Date.now() - at > UNDO_WINDOW_MS) throw new UserError("O prazo para desfazer passou. Se o estoque estiver errado, faça um ajuste manual.");
  if (str(dose as R, "confirmed_by_member_id") !== ctx.member.id && !can(ctx.member, "settings.manage")) throw new UserError("Só quem confirmou pode desfazer.");
  const res = await services().doses.undo({ familyId: ctx.familyId, doseEventId: doseId, memberId: ctx.member.id });
  if (res.result === "not_found" || res.result === "not_taken") throw new UserError("Esta dose não está mais confirmada.");
}

/** "Lembrar de novo": enfileira o lembrete para quem responde pela dose, para daqui a `minutes` (a outbox entrega). */
export async function snoozeDose(ctx: Ctx, doseId: string, minutes: number): Promise<void> {
  requirePermission(ctx, "doses.confirm");
  const dose = (await ctx.db.get("dose_events", doseId)) as unknown as R;
  if (["taken", "skipped"].includes(str(dose, "status"))) throw new UserError("Esta dose já foi registrada.");
  const [patient, med] = await Promise.all([ctx.db.get("patients", str(dose, "patient_id")), ctx.db.get("medications", str(dose, "medication_id"))]);
  const at = new Date(str(dose, "scheduled_at"));
  const responsible = await services().domain.resolveResponsible({ familyId: ctx.familyId, patientId: str(dose, "patient_id"), at });
  const unit = str(med as unknown as R, "control_unit");
  const amount = num(dose, "amount");
  const word = unit === "drop" ? (amount === 1 ? "gota" : "gotas") : unit === "ml" ? "ml" : unit === "gram" ? "g" : amount === 1 ? "unidade" : "unidades";
  const time = new Intl.DateTimeFormat("pt-BR", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const now = new Date();
  const slot = Math.floor(now.getTime() / 60_000); // um pedido por minuto e por dose
  for (const memberId of responsible.length ? responsible : [ctx.member.id]) {
    await enqueue(
      services().dataFor(ctx.familyId),
      {
        kind: "dose_reminder",
        template: "dose_reminder",
        params: { familyId: ctx.familyId, doseEventId: doseId, patientName: str(patient as unknown as R, "name"), medicationName: str(med as unknown as R, "name"), doseText: `${amount} ${word}`, time, snoozeMin: minutes, late: true },
        targetMemberId: memberId,
        dedupeKey: `snooze:${doseId}:${memberId}:${slot}`,
        notBefore: new Date(now.getTime() + minutes * 60_000),
      },
      now,
    );
  }
  await audit(ctx.db, ctx.member.id, "reminder.snooze", "dose_event", doseId, { minutes });
}

// ───────────────────────── estoque ─────────────────────────

export async function registerPurchase(ctx: Ctx, medId: string, qty: number): Promise<void> {
  requirePermission(ctx, "stock.adjust");
  const item = await stockItemFor(ctx, medId);
  await services().stock.registerPurchase({ familyId: ctx.familyId, stockItemId: item.$id, quantity: qty, memberId: ctx.member.id });
  await audit(ctx.db, ctx.member.id, "stock.purchase", "stock_item", item.$id, { quantity: qty });
}

export async function adjustStock(ctx: Ctx, medId: string, newBalance: number, reason: string): Promise<void> {
  requirePermission(ctx, "stock.adjust");
  const item = await stockItemFor(ctx, medId);
  await services().stock.adjust({ familyId: ctx.familyId, stockItemId: item.$id, newBalance, memberId: ctx.member.id, ...(reason ? { note: reason.slice(0, 200) } : {}) });
}

export async function previewStockDays(ctx: Ctx, medId: string, delta: number): Promise<number> {
  requirePermission(ctx, "stock.view");
  const t = await treatmentForMed(ctx, medId);
  const item = await stockItemFor(ctx, medId);
  const moves = await listAll(ctx.db, "stock_movements", [Query.equal("stock_item_id", item.$id)], 5000);
  const balance = moves.reduce((s, m) => s + num(m, "quantity"), 0) + delta;
  const phases = await listAll(ctx.db, "treatment_phases", [Query.equal("treatment_id", t.$id)]);
  const { forecastDepletion } = await import("@medcuidar/domain");
  const toYmd = (iso: string) => iso.slice(0, 10);
  const f = forecastDepletion(
    { balance, is_estimate: item["is_estimate"] === true },
    { id: t.$id, family_id: ctx.familyId, patient_id: str(t, "patient_id"), medication_id: medId, start_date: toYmd(str(t, "start_date")), end_date: t["end_date"] ? toYmd(str(t, "end_date")) : null, status: "active" },
    phases.map((p) => ({ id: p.$id, treatment_id: t.$id, order: num(p, "order"), start_day: num(p, "start_day"), end_day: p["end_day"] == null ? null : num(p, "end_day"), schedule_type: str(p, "schedule_type") as "interval" | "fixed_times", interval_hours: p["interval_hours"] == null ? null : num(p, "interval_hours"), first_dose_time: p["first_dose_time"] ? str(p, "first_dose_time") : null, times: strList(p, "times"), dose_amount: num(p, "dose_amount") })),
    new Date(),
    ctx.timezone,
  );
  return f.daysLeft ?? 365;
}

// ───────────────────────── reposição ─────────────────────────

export async function assumeReplenishment(ctx: Ctx, medId: string): Promise<void> {
  requirePermission(ctx, "replenishment.manage");
  const { id, patientId } = await openReplenishmentId(ctx, medId);
  const steps = await listAll(ctx.db, "replenishment_steps", [Query.equal("replenishment_id", id)]);
  const cur = steps.sort((a, b) => num(a, "step") - num(b, "step")).find((s) => !s["done_at"]);
  const takeOver = !!cur?.["owner_member_id"] && str(cur, "owner_member_id") !== ctx.member.id;
  const res = await services().replenishment.claim({ familyId: ctx.familyId, replenishmentId: id, memberId: ctx.member.id, takeOver });
  if (!res.ok) throw new UserError(res.reason === "already_claimed" ? "Outra pessoa já assumiu esta etapa." : "Não foi possível assumir esta etapa.");
  await audit(ctx.db, ctx.member.id, "replenishment.claimed", "replenishment", id, { patientId, medicationIds: [medId] });
}

export async function advanceReplenishment(ctx: Ctx, medId: string, quantity?: number): Promise<void> {
  requirePermission(ctx, "replenishment.manage");
  const { id, patientId } = await openReplenishmentId(ctx, medId);
  const res = await services().replenishment.advance({ familyId: ctx.familyId, replenishmentId: id, memberId: ctx.member.id, action: "complete", ...(quantity ? { purchaseQuantity: quantity } : {}) });
  if (!res.ok) {
    const msg: Record<string, string> = { missing_purchase_quantity: "Informe a quantidade comprada.", not_owner: 'Outra pessoa assumiu esta etapa. Use "Assumir no lugar".', closed: "Esta reposição já foi encerrada." };
    throw new UserError(msg[res.reason] ?? "Não foi possível concluir a etapa.");
  }
  await audit(ctx.db, ctx.member.id, res.replenishment.status === "done" ? "replenishment.done" : "replenishment.step_done", "replenishment", id, { patientId, medicationIds: [medId] });
}

// ───────────────────────── receitas ─────────────────────────

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const { storage } = clients();
  try {
    await storage.getBucket(PRESCRIPTION_BUCKET);
  } catch (e) {
    if ((e as { code?: number }).code !== 404) throw e;
    // Sem permissão de bucket: só chave de API e permissões por arquivo (Team da família). Dados de saúde: nunca público.
    await storage.createBucket({ bucketId: PRESCRIPTION_BUCKET, name: "Receitas", permissions: [], fileSecurity: true, enabled: true, maximumFileSize: 15 * 1024 * 1024, allowedFileExtensions: ["jpg", "jpeg", "png", "webp", "heic", "pdf"], encryption: true, antivirus: false });
  }
  bucketReady = true;
}

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_FILES = 20;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };

async function uploadFiles(ctx: Ctx, files: File[]): Promise<Array<{ storageFileId: string; page: number; mime: string; size: number }>> {
  if (files.length > MAX_FILES) throw new UserError(`No máximo ${MAX_FILES} páginas por receita.`);
  await ensureBucket();
  const out: Array<{ storageFileId: string; page: number; mime: string; size: number }> = [];
  try {
    let page = 1;
    for (const f of files) {
      const mime = f.type || "application/octet-stream";
      if (!EXT[mime]) throw new UserError("Use fotos (JPG, PNG, WEBP) ou PDF.");
      if (f.size > MAX_FILE_BYTES) throw new UserError("Cada página pode ter até 15 MB.");
      const buf = Buffer.from(await f.arrayBuffer());
      // nome do arquivo neutro: nada de dados pessoais no Storage
      const created = await clients().storage.createFile(PRESCRIPTION_BUCKET, ID.unique(), InputFile.fromBuffer(buf, `rx-p${page}.${EXT[mime]}`), [Permission.read(Role.team(ctx.familyId))]);
      out.push({ storageFileId: created.$id, page: page++, mime, size: f.size });
    }
  } catch (e) {
    for (const o of out) await clients().storage.deleteFile(PRESCRIPTION_BUCKET, o.storageFileId).catch(() => undefined);
    throw e;
  }
  return out;
}

export function parseBrDate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  return d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 ? d.toISOString().slice(0, 10) : null;
}

const VALIDITY_DAYS: Record<string, number | null> = { "30": 30, "60": 60, "180": 180, none: null };

export async function saveRx(ctx: Ctx, draft: AttachDraft, files: File[]): Promise<string> {
  requirePermission(ctx, "prescriptions.upload");
  const issued = parseBrDate(draft.date);
  const today = new Date().toISOString().slice(0, 10);
  if (!issued || issued > addDaysYmd(today, 1)) throw new UserError("Use a data da receita no formato dd/mm/aaaa, de hoje ou anterior.");
  if (draft.medicationIds.length === 0) throw new UserError("Escolha pelo menos um remédio desta receita.");
  const days = VALIDITY_DAYS[draft.validity] ?? null;
  const validUntil = days == null ? undefined : noon(addDaysYmd(issued, days));

  // o paciente e os remédios precisam ser da família (FamilyScopedDb recusa de outra)
  await ctx.db.get("patients", draft.patientId);
  for (const mid of draft.medicationIds) await ctx.db.get("medications", mid);

  if (draft.editId) {
    const rx = await ctx.db.get("prescriptions", draft.editId);
    await ctx.db.update("prescriptions", rx.$id, {
      patient_id: draft.patientId,
      issued_on: noon(issued),
      valid_until: validUntil ?? null,
      doctor_name: draft.doctor.trim() || null,
      specialty: draft.specialty.trim() || null,
      is_controlled: !!draft.controlled,
      copies: draft.controlled ? (draft.copies ?? 1) : null,
      notes: draft.notes.trim() || null,
    });
    const have = await listAll(ctx.db, "prescription_items", [Query.equal("prescription_id", rx.$id)]);
    for (const it of have) if (!draft.medicationIds.includes(str(it, "medication_id"))) await ctx.db.remove("prescription_items", it.$id);
    for (const mid of draft.medicationIds) if (!have.some((it) => str(it, "medication_id") === mid)) await ctx.db.create("prescription_items", { prescription_id: rx.$id, medication_id: mid });
    await audit(ctx.db, ctx.member.id, "rx.edited", "prescription", rx.$id, { patientId: draft.patientId, medicationIds: draft.medicationIds });
    return rx.$id;
  }

  if (files.length === 0) throw new UserError("Adicione pelo menos uma página da receita.");
  const uploaded = await uploadFiles(ctx, files);
  let saved;
  try {
    saved = await services().prescriptions.save({
      familyId: ctx.familyId,
      memberId: ctx.member.id,
      patientId: draft.patientId,
      issuedOn: noon(issued),
      ...(validUntil ? { validUntil } : {}),
      ...(draft.doctor.trim() ? { doctorName: draft.doctor.trim() } : {}),
      ...(draft.specialty.trim() ? { specialty: draft.specialty.trim() } : {}),
      isControlled: !!draft.controlled,
      ...(draft.controlled ? { copies: draft.copies ?? 1 } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      medicationIds: draft.medicationIds,
      files: uploaded,
    });
  } catch (e) {
    for (const o of uploaded) await clients().storage.deleteFile(PRESCRIPTION_BUCKET, o.storageFileId).catch(() => undefined);
    throw e;
  }
  await audit(ctx.db, ctx.member.id, "rx.attached", "prescription", saved.prescriptionId, { patientId: draft.patientId, medicationIds: draft.medicationIds, pages: uploaded.length });
  const replaces = draft.replacesId && !saved.superseded.includes(draft.replacesId) ? [draft.replacesId] : [];
  for (const old of replaces) {
    const doc = await ctx.db.get("prescriptions", old);
    if (str(doc as R, "patient_id") === draft.patientId) await ctx.db.update("prescriptions", old, { status: "superseded", superseded_by_id: saved.prescriptionId });
  }
  if (saved.superseded.length + replaces.length > 0) await audit(ctx.db, ctx.member.id, "rx.superseded", "prescription", saved.prescriptionId, { patientId: draft.patientId, medicationIds: draft.medicationIds });
  return saved.prescriptionId;
}

export async function deleteRx(ctx: Ctx, id: string): Promise<void> {
  requirePermission(ctx, "prescriptions.delete");
  await ctx.db.update("prescriptions", id, { deleted_at: nowIso() });
  await audit(ctx.db, ctx.member.id, "rx.deleted", "prescription", id, {});
}

export async function restoreRx(ctx: Ctx, id: string): Promise<void> {
  requirePermission(ctx, "prescriptions.delete");
  await ctx.db.update("prescriptions", id, { deleted_at: null });
  await audit(ctx.db, ctx.member.id, "rx.restored", "prescription", id, {});
}

export async function markSuperseded(ctx: Ctx, id: string): Promise<void> {
  requirePermission(ctx, "prescriptions.upload");
  const rx = await ctx.db.update("prescriptions", id, { status: "superseded" });
  await audit(ctx.db, ctx.member.id, "rx.superseded", "prescription", id, { patientId: str(rx as R, "patient_id"), medicationIds: await medIdsOfRx(ctx, id) });
}

export async function recordRxView(ctx: Ctx, id: string): Promise<void> {
  requirePermission(ctx, "prescriptions.view");
  await ctx.db.get("prescriptions", id);
  const recent = await ctx.db.list("prescription_views", [Query.equal("prescription_id", id), Query.equal("member_id", ctx.member.id), Query.orderDesc("viewed_at"), Query.limit(1)]);
  const last = recent.documents[0] ? new Date(String(recent.documents[0]["viewed_at"])).getTime() : 0;
  if (Date.now() - last < 60_000) return; // a mesma abertura não vira dezenas de registros
  await services().prescriptions.recordView({ familyId: ctx.familyId, prescriptionId: id, memberId: ctx.member.id });
}

export async function shareRx(ctx: Ctx, id: string, target: ShareTarget, channel: "WhatsApp" | "MedCuidar"): Promise<void> {
  requirePermission(ctx, "prescriptions.view", "prescriptions.share");
  const rx = await ctx.db.get("prescriptions", id);
  const members = await listAll(ctx.db, "members");
  const profiles = await listAll(ctx.db, "profiles");
  const canView = (m: R) => {
    const p = profiles.find((x) => x.$id === str(m, "profile_id"));
    let perms: PermissionMap = {};
    try {
      perms = p ? parseJsonField(permissionMapSchema, str(p, "permissions") || "{}") : {};
    } catch {
      perms = {};
    }
    return m["active"] === true && can({ profileName: str(p, "name"), permissions: perms }, "prescriptions.view");
  };
  const targets = (target.memberIds ?? []).map((mid) => members.find((m) => m.$id === mid));
  if (targets.some((m) => !m)) throw new UserError("Pessoa não encontrada.");
  if (targets.some((m) => !canView(m!))) throw new UserError("Alguém da lista não tem permissão para ver receitas.");

  if (channel === "MedCuidar") {
    if (targets.length === 0) throw new UserError("Escolha pelo menos uma pessoa.");
    for (const m of targets) await ctx.db.create("prescription_shares", { prescription_id: id, shared_by_member_id: ctx.member.id, channel: "internal", target_member_id: m!.$id, shared_at: nowIso() });
  } else {
    if (targets.length === 0) throw new UserError("O envio para farmácia, grupo ou outro número ainda não está disponível. Envie para uma pessoa da família.");
    for (const m of targets) {
      const r = await services().prescriptions.share({ familyId: ctx.familyId, prescriptionId: id, memberId: ctx.member.id, targetMemberId: m!.$id });
      if (!r.shared) throw new UserError("Esta receita não tem foto para enviar.");
    }
  }
  await audit(ctx.db, ctx.member.id, "rx.shared", "prescription", id, { patientId: str(rx as R, "patient_id"), medicationIds: await medIdsOfRx(ctx, id), channel: channel === "WhatsApp" ? "whatsapp" : "internal", targets: targets.length });
}

// ───────────────────────── perfis e avisos ─────────────────────────

export async function setPermission(ctx: Ctx, rowId: string, profileName: string, value: boolean): Promise<void> {
  requirePermission(ctx, "profiles.manage");
  const group = PERMISSION_GROUPS.find((g) => g.id === rowId);
  if (!group) throw new UserError("Funcionalidade desconhecida.");
  if (profileName === "Administrador") throw new UserError("O Administrador sempre pode tudo.");
  const profiles = await listAll(ctx.db, "profiles");
  const profile = profiles.find((p) => str(p, "name") === profileName);
  if (!profile) throw new UserError("Perfil não encontrado.");
  if (group.keys.length === 0) {
    // "Receber avisos": liga/desliga os avisos da família para quem tem este perfil
    for (const m of await listAll(ctx.db, "members", [Query.equal("profile_id", profile.$id)])) await ctx.db.update("members", m.$id, { receives_family_alerts: value });
  } else {
    const perms = parseJsonField(permissionMapSchema, str(profile, "permissions") || "{}");
    for (const k of group.keys) perms[k] = value;
    await ctx.db.update("profiles", profile.$id, { permissions: JSON.stringify(perms) });
  }
  await audit(ctx.db, ctx.member.id, "profile.updated", "profile", profile.$id, { group: rowId, value });
}

export async function setNotification(ctx: Ctx, patch: Partial<NotificationSettingsVM>): Promise<void> {
  requirePermission(ctx, "settings.manage");
  const { databases, databaseId } = clients();
  const fam = await databases.getDocument(databaseId, "families", ctx.familyId);
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(String(fam["settings"] ?? "{}")) as Record<string, unknown>;
  } catch {
    settings = {};
  }
  const int = (n: number | undefined, min: number, max: number) => (n !== undefined && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined);
  const set = (k: string, v: unknown) => {
    if (v !== undefined) settings[k] = v;
  };
  set("default_low_stock_days", int(patch.leadDays, 1, 30));
  set("late_after_min", int(patch.lateAfterMin, 1, 600));
  set("missed_after_min", int(patch.missedAfterMin, 1, 1440));
  set("default_reminder_retry_min", patch.repeatEveryMin);
  if (patch.summaryTime !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.summaryTime)) throw new UserError("Use o horário no formato 24h, por exemplo 20:00.");
    settings["daily_summary_time"] = patch.summaryTime;
  }
  // sem campo próprio no esquema da família ainda: guardados como chaves extras (registrado em docs/handoffs)
  set("reminder_at_time", patch.reminderAtTime);
  set("daily_summary_enabled", patch.dailySummary);
  if (Object.keys(patch).some((k) => ["leadDays", "lateAfterMin", "missedAfterMin", "repeatEveryMin", "summaryTime", "reminderAtTime", "dailySummary"].includes(k))) {
    await databases.updateDocument(databaseId, "families", ctx.familyId, { settings: JSON.stringify(settings) });
  }
  if (patch.receivers) {
    const members = await listAll(ctx.db, "members");
    for (const [name, on] of Object.entries(patch.receivers)) {
      const m = members.find((x) => str(x, "name") === name && x["active"] === true);
      if (m && m["receives_family_alerts"] !== on) await ctx.db.update("members", m.$id, { receives_family_alerts: on });
    }
  }
  if (patch.exceptions) {
    const treatments = (await listAll(ctx.db, "treatments")).filter((t) => !t["deleted_at"]);
    for (const t of treatments) {
      const ex = patch.exceptions.find((e) => e.medicationId === str(t, "medication_id"));
      const want = ex ? Math.min(30, Math.max(1, Math.round(ex.days))) : null;
      if ((t["low_stock_days"] ?? null) !== want) await ctx.db.update("treatments", t.$id, { low_stock_days: want });
    }
  }
  if (patch.nightTo !== undefined) {
    const members = await listAll(ctx.db, "members");
    const who = members.find((m) => str(m, "name") === patch.nightTo && m["active"] === true);
    if (!who) throw new UserError("Pessoa não encontrada.");
    for (const a of await listAll(ctx.db, "care_assignments")) if (str(a, "start_time") >= str(a, "end_time")) await ctx.db.update("care_assignments", a.$id, { member_id: who.$id });
  }
  await audit(ctx.db, ctx.member.id, "settings.updated", "family", ctx.familyId, { keys: Object.keys(patch) });
}

// ───────────────────────── remédios e esquemas ─────────────────────────

export async function updateMedication(ctx: Ctx, medId: string, patch: MedicationPatch): Promise<void> {
  requirePermission(ctx, "medications.manage");
  const med = await ctx.db.get("medications", medId);
  const data: Record<string, unknown> = {};
  const name = patch.name?.trim();
  if (patch.name !== undefined) {
    if (!name) throw new UserError("Dê um nome ao remédio.");
    data["name"] = name.slice(0, 120);
  }
  if (patch.alternatives !== undefined) data["alternative_names"] = patch.alternatives.filter((a) => a && a !== (name ?? str(med as R, "name"))).slice(0, 10).map((a) => a.slice(0, 60));
  if (patch.routeLabel !== undefined) {
    const route = ROUTE_BY_LABEL[patch.routeLabel];
    if (!route) throw new UserError("Tipo de uso inválido.");
    data["route"] = route;
  }
  if (Object.keys(data).length) await ctx.db.update("medications", medId, data);
  if (patch.perDose !== undefined) {
    requirePermission(ctx, "treatments.manage");
    if (!(patch.perDose > 0)) throw new UserError("Informe uma quantidade maior que zero.");
    const t = await treatmentForMed(ctx, medId);
    for (const p of await listAll(ctx.db, "treatment_phases", [Query.equal("treatment_id", t.$id)])) await ctx.db.update("treatment_phases", p.$id, { dose_amount: patch.perDose });
  }
  await audit(ctx.db, ctx.member.id, "medication.updated", "medication", medId, {});
}

async function setMedicationActive(ctx: Ctx, medId: string, active: boolean): Promise<void> {
  requirePermission(ctx, "medications.manage");
  await ctx.db.update("medications", medId, { deleted_at: active ? null : nowIso() });
  // pausa os tratamentos (sem lembretes nem doses novas); restaurar reativa
  for (const t of await listAll(ctx.db, "treatments", [Query.equal("medication_id", medId)])) {
    if (active && str(t, "status") === "paused") await ctx.db.update("treatments", t.$id, { status: "active" });
    if (!active && str(t, "status") === "active") await ctx.db.update("treatments", t.$id, { status: "paused" });
  }
  await audit(ctx.db, ctx.member.id, active ? "medication.restored" : "medication.deleted", "medication", medId, {});
}
export const deleteMedication = (ctx: Ctx, id: string) => setMedicationActive(ctx, id, false);
export const restoreMedication = (ctx: Ctx, id: string) => setMedicationActive(ctx, id, true);

export async function saveScheme(ctx: Ctx, medId: string, input: SchemeInput): Promise<void> {
  requirePermission(ctx, "treatments.manage");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.firstTime)) throw new UserError("Use o primeiro horário no formato 24h, por exemplo 08:00.");
  const t = await treatmentForMed(ctx, medId);
  const docs = (await listAll(ctx.db, "treatment_phases", [Query.equal("treatment_id", t.$id)])).sort((a, b) => num(a, "order") - num(b, "order"));
  const wanted = input.single ? input.phases.slice(0, 1) : input.phases;
  for (const ph of wanted) {
    if (!(ph.everyHours >= 1 && ph.everyHours <= 24)) throw new UserError("As horas entre as doses devem ficar entre 1 e 24.");
    const doc = docs.find((d) => num(d, "order") === ph.order);
    if (!doc) continue;
    const fixed = str(doc, "schedule_type") === "fixed_times";
    await ctx.db.update("treatment_phases", doc.$id, {
      start_day: Math.max(1, ph.fromDay),
      end_day: input.single ? null : ph.toDay,
      ...(fixed && ph.everyHours === 24 ? { times: [input.firstTime] } : { schedule_type: "interval", interval_hours: ph.everyHours, first_dose_time: input.firstTime }),
    });
  }
  if (input.single) for (const extra of docs.filter((d) => num(d, "order") > 1)) await ctx.db.remove("treatment_phases", extra.$id);
  await audit(ctx.db, ctx.member.id, "scheme.updated", "treatment", t.$id, {});
}

// ───────────────────────── pessoas ─────────────────────────

async function profileByName(ctx: Ctx, name: string): Promise<R> {
  const p = (await listAll(ctx.db, "profiles")).find((x) => str(x, "name") === name);
  if (!p) throw new UserError("Perfil não encontrado.");
  return p;
}

const isAdmin = (ctx: Ctx) => ctx.member.profileName === "Administrador";

export async function inviteMember(ctx: Ctx, input: MemberInput): Promise<void> {
  requirePermission(ctx, "members.manage");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
  if (input.profileName === "Administrador" && !isAdmin(ctx)) throw new UserError("Só um Administrador pode criar outro Administrador.");
  const profile = await profileByName(ctx, input.profileName);
  const dup = (await listAll(ctx.db, "members", [Query.equal("phone_e164", phone)]))[0];
  if (dup) throw new UserError("Já existe uma pessoa com este telefone.");
  const m = await ctx.db.create("members", { name: input.name.trim().slice(0, 80), phone_e164: phone, profile_id: profile.$id, active: true, receives_family_alerts: false, whatsapp_status: "unverified", role_label: input.relation.trim().slice(0, 60) });
  await audit(ctx.db, ctx.member.id, "member.invited", "member", m.$id, {});
}

export async function updateMember(ctx: Ctx, id: string, input: MemberInput): Promise<void> {
  requirePermission(ctx, "members.manage");
  const target = await ctx.db.get("members", id);
  const targetProfile = (await listAll(ctx.db, "profiles")).find((p) => p.$id === str(target as R, "profile_id"));
  if ((str(targetProfile, "name") === "Administrador" || input.profileName === "Administrador") && !isAdmin(ctx)) throw new UserError("Só um Administrador pode alterar um Administrador.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
  const profile = await profileByName(ctx, input.profileName);
  if (str(targetProfile, "name") === "Administrador" && input.profileName !== "Administrador") {
    const admins = (await listAll(ctx.db, "members")).filter((m) => m["active"] === true && str(m, "profile_id") === targetProfile!.$id);
    if (admins.length <= 1) throw new UserError("A família precisa de pelo menos um Administrador.");
  }
  const clash = (await listAll(ctx.db, "members", [Query.equal("phone_e164", phone)])).find((m) => m.$id !== id);
  if (clash) throw new UserError("Já existe outra pessoa com este telefone.");
  await ctx.db.update("members", id, { name: input.name.trim().slice(0, 80), phone_e164: phone, profile_id: profile.$id, role_label: input.relation.trim().slice(0, 60) });
  await audit(ctx.db, ctx.member.id, "member.updated", "member", id, {});
}

export async function removeMember(ctx: Ctx, id: string): Promise<void> {
  requirePermission(ctx, "members.manage");
  if (id === ctx.member.id) throw new UserError("Você não pode remover a si mesmo.");
  const target = await ctx.db.get("members", id);
  const profile = (await listAll(ctx.db, "profiles")).find((p) => p.$id === str(target as R, "profile_id"));
  if (str(profile, "name") === "Administrador") {
    if (!isAdmin(ctx)) throw new UserError("Só um Administrador pode remover um Administrador.");
    const admins = (await listAll(ctx.db, "members")).filter((m) => m["active"] === true && str(m, "profile_id") === profile!.$id);
    if (admins.length <= 1) throw new UserError("A família precisa de pelo menos um Administrador.");
  }
  // remove da escala e desativa (histórico e auditoria continuam apontando para a pessoa)
  for (const a of await listAll(ctx.db, "care_assignments", [Query.equal("member_id", id)])) await ctx.db.remove("care_assignments", a.$id);
  await ctx.db.update("members", id, { active: false });
  await audit(ctx.db, ctx.member.id, "member.removed", "member", id, {});
}
