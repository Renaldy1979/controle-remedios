"use server";
import { z } from "zod";
import type { Snapshot } from "@/data/types";

/**
 * Server Actions: ÚNICA porta de escrita do painel. Cada uma valida a entrada (zod), relê a sessão
 * assinada (familyId e membro nunca vêm do cliente), confere a permissão no servidor e devolve o
 * retrato atualizado. Erros viram mensagens seguras; nada de dado pessoal em log.
 */
export type ActionResult<T = undefined> = { ok: true; snapshot: Snapshot; data?: T } | { ok: false; message: string; unauthorized?: boolean };

const id = z.string().min(1).max(64).regex(/^[\w.-]+$/);
const qty = z.number().finite().positive().max(1_000_000);
const text = (max: number) => z.string().max(max);

async function run<T>(fn: (ctx: import("./context").Ctx, m: typeof import("./mutations")) => Promise<T>): Promise<ActionResult<T>> {
  const { getContext, ForbiddenError } = await import("./context");
  const m = await import("./mutations");
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: "Sua sessão expirou. Entre de novo.", unauthorized: true };
  try {
    const data = await fn(ctx, m);
    const { buildSnapshot } = await import("./snapshot");
    return { ok: true, snapshot: await buildSnapshot(ctx), ...(data === undefined ? {} : { data }) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: "Seu perfil não tem permissão para fazer isso." };
    if (e instanceof m.UserError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: "Confira os dados informados." };
    const code = (e as { code?: number }).code;
    console.error("[action] falhou", (e as Error).name, code ?? "");
    return { ok: false, message: "Não foi possível concluir. Tente de novo." };
  }
}

const parse = <S extends z.ZodTypeAny>(schema: S, v: unknown): z.infer<S> => schema.parse(v);

export async function loadSnapshotAction(): Promise<ActionResult> {
  return run(async () => undefined);
}

export async function confirmDoseAction(doseId: string) {
  return run((c, m) => m.confirmDose(c, parse(id, doseId)));
}
export async function undoDoseAction(doseId: string) {
  return run((c, m) => m.undoDose(c, parse(id, doseId)));
}
export async function snoozeDoseAction(doseId: string, minutes: number) {
  return run((c, m) => m.snoozeDose(c, parse(id, doseId), parse(z.number().int().min(1).max(240), minutes)));
}
export async function registerPurchaseAction(medId: string, quantity: number) {
  return run((c, m) => m.registerPurchase(c, parse(id, medId), parse(qty, quantity)));
}
export async function adjustStockAction(medId: string, newBalance: number, reason: string) {
  return run((c, m) => m.adjustStock(c, parse(id, medId), parse(z.number().finite().min(0).max(1_000_000), newBalance), parse(text(200), reason)));
}
export async function previewStockDaysAction(medId: string, delta: number): Promise<{ ok: true; days: number } | { ok: false; message: string }> {
  const { getContext } = await import("./context");
  const m = await import("./mutations");
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: "Sua sessão expirou." };
  try {
    return { ok: true, days: await m.previewStockDays(ctx, parse(id, medId), parse(z.number().finite().min(-1_000_000).max(1_000_000), delta)) };
  } catch {
    return { ok: false, message: "Não foi possível calcular." };
  }
}
export async function assumeReplenishmentAction(medId: string) {
  return run((c, m) => m.assumeReplenishment(c, parse(id, medId)));
}
export async function advanceReplenishmentAction(medId: string, quantity?: number) {
  return run((c, m) => m.advanceReplenishment(c, parse(id, medId), quantity === undefined ? undefined : parse(qty, quantity)));
}

const draftSchema = z.object({
  patientId: id,
  date: text(10),
  doctor: text(120),
  specialty: text(80),
  medicationIds: z.array(id).min(1).max(20),
  validity: z.enum(["30", "60", "180", "none"]),
  notes: text(1000),
  pages: z.number().int().min(0).max(50),
  controlled: z.boolean().optional(),
  copies: z.number().int().min(1).max(9).optional(),
  replacesId: id.nullish(),
  editId: id.nullish(),
});

/** Anexar/editar receita: FormData com `draft` (JSON) e `files` (as páginas). */
export async function saveRxAction(form: FormData): Promise<ActionResult<string>> {
  return run(async (c, m) => {
    const draft = parse(draftSchema, JSON.parse(String(form.get("draft") ?? "{}")));
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    return m.saveRx(c, draft, files);
  });
}
export async function deleteRxAction(rxId: string) {
  return run((c, m) => m.deleteRx(c, parse(id, rxId)));
}
export async function restoreRxAction(rxId: string) {
  return run((c, m) => m.restoreRx(c, parse(id, rxId)));
}
export async function markSupersededAction(rxId: string) {
  return run((c, m) => m.markSuperseded(c, parse(id, rxId)));
}
export async function recordRxViewAction(rxId: string): Promise<{ ok: boolean }> {
  const { getContext } = await import("./context");
  const m = await import("./mutations");
  const ctx = await getContext();
  if (!ctx) return { ok: false };
  try {
    await m.recordRxView(ctx, parse(id, rxId));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
export async function shareRxAction(rxId: string, target: { memberIds?: string[]; phone?: string; label: string; message?: string }, channel: "WhatsApp" | "MedCuidar") {
  return run((c, m) =>
    m.shareRx(
      c,
      parse(id, rxId),
      parse(z.object({ memberIds: z.array(id).max(20).optional(), phone: text(30).optional(), label: text(120), message: text(1000).optional() }), target),
      parse(z.enum(["WhatsApp", "MedCuidar"]), channel),
    ),
  );
}

export async function setPermissionAction(rowId: string, profile: string, value: boolean) {
  return run((c, m) => m.setPermission(c, parse(id, rowId), parse(text(40), profile), parse(z.boolean(), value)));
}

const notifSchema = z
  .object({
    leadDays: z.number().int().min(1).max(30),
    exceptions: z.array(z.object({ medicationId: id, days: z.number().int().min(1).max(30) })).max(50),
    receivers: z.record(text(80), z.boolean()),
    reminderAtTime: z.boolean(),
    dailySummary: z.boolean(),
    summaryTime: text(5),
    repeatEveryMin: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    lateAfterMin: z.number().int().min(1).max(600),
    missedAfterMin: z.number().int().min(1).max(1440),
    nightTo: text(80),
  })
  .partial()
  .strict();
export async function setNotificationAction(patch: unknown) {
  return run((c, m) => m.setNotification(c, parse(notifSchema, patch)));
}

export async function updateMedicationAction(medId: string, patch: { name?: string; alternatives?: string[]; routeLabel?: string; perDose?: number }) {
  return run((c, m) =>
    m.updateMedication(
      c,
      parse(id, medId),
      parse(z.object({ name: text(120).optional(), alternatives: z.array(text(60)).max(10).optional(), routeLabel: text(30).optional(), perDose: qty.optional() }).strict(), patch),
    ),
  );
}
export async function deleteMedicationAction(medId: string) {
  return run((c, m) => m.deleteMedication(c, parse(id, medId)));
}
export async function restoreMedicationAction(medId: string) {
  return run((c, m) => m.restoreMedication(c, parse(id, medId)));
}
export async function saveSchemeAction(medId: string, input: unknown) {
  const phase = z.object({ order: z.number().int().min(1).max(10), everyHours: z.number().min(1).max(24), fromDay: z.number().int().min(1).max(3650), toDay: z.number().int().min(1).max(3650).nullable(), perDose: z.number().positive() });
  return run((c, m) => m.saveScheme(c, parse(id, medId), parse(z.object({ single: z.boolean(), firstTime: text(5), phases: z.array(phase).min(1).max(10) }), input)));
}

const memberSchema = z.object({ name: z.string().trim().min(1).max(80), phone: text(30), profileName: text(40), relation: text(60) });
export async function inviteMemberAction(input: unknown) {
  return run((c, m) => m.inviteMember(c, parse(memberSchema, input)));
}
export async function updateMemberAction(memberId: string, input: unknown) {
  return run((c, m) => m.updateMember(c, parse(id, memberId), parse(memberSchema, input)));
}
export async function removeMemberAction(memberId: string) {
  return run((c, m) => m.removeMember(c, parse(id, memberId)));
}
