"use server";
import { z } from "zod";
import { ROUTE_BY_LABEL, UNIT_BY_LABEL } from "@/lib/labels";
import type { InviteResult, Snapshot } from "@/data/types";

/**
 * Server Actions do portal (Lote 1): a ÚNICA porta de escrita das telas. Cada uma valida a entrada (zod), relê a
 * sessão (familyId e membro nunca vêm do cliente), confere a permissão no servidor (nas funções de negócio) e
 * devolve o retrato atualizado. Erros viram mensagens seguras; nada de dado pessoal em log.
 */
export type ActionResult<T = undefined> =
  | { ok: true; snapshot: Snapshot; data?: T }
  | { ok: false; message: string; unauthorized?: boolean };

const id = z.string().uuid();
const name = (max = 120) => z.string().trim().min(1, "Informe o nome.").max(max);
const optText = (max: number) => z.string().trim().max(max);
const quantity = z.number({ invalid_type_error: "Informe a quantidade." }).finite("Informe a quantidade.").min(0).max(100_000);

async function run<T>(fn: (ctx: import("./access").Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const [{ getContext }, { UserError, ForbiddenError }, { buildSnapshot }] = await Promise.all([
    import("./access"), import("./errors"), import("./snapshot"),
  ]);
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: "Sua sessão expirou. Entre de novo.", unauthorized: true };
  try {
    const data = await fn(ctx);
    const { prepareDaySafe } = await import("./prepare");
    await prepareDaySafe(ctx); // gera as doses de hoje (idempotente), atraso/esquecida e aviso de estoque baixo
    return { ok: true, snapshot: await buildSnapshot(ctx), ...(data === undefined ? {} : { data }) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: "Seu perfil não tem permissão para fazer isso." };
    if (e instanceof UserError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Confira os dados informados." };
    console.error("[action] falhou", (e as Error).name, (e as { code?: unknown }).code ?? "");
    return { ok: false, message: "Não foi possível concluir. Tente de novo." };
  }
}

const parse = <S extends z.ZodTypeAny>(schema: S, v: unknown): z.infer<S> => schema.parse(v);

async function deps() {
  const [{ sendInviteEmail, revokeUserSessions, setUserEnabled }, { appUrl }] = await Promise.all([import("../auth/appwrite"), import("../env")]);
  return { auth: { sendInviteEmail, revokeSessions: revokeUserSessions, setEnabled: setUserEnabled }, baseUrl: appUrl() };
}

export async function loadSnapshotAction(): Promise<ActionResult> {
  return run(async () => undefined);
}

// ---------- pessoas ----------

// ---------- doses (Lote 2) ----------

export async function confirmDoseAction(doseId: string) {
  return run(async (ctx) => (await import("./doses")).confirmDose(ctx, parse(id, doseId)).then(() => undefined));
}
/** Também serve para "registrar que tomou depois" (dose atrasada ou esquecida). */
export const registerLateDoseAction = confirmDoseAction;
export async function undoDoseAction(doseId: string) {
  return run(async (ctx) => (await import("./doses")).undoDose(ctx, parse(id, doseId)).then(() => undefined));
}
export async function snoozeDoseAction(doseId: string, minutes: number) {
  return run(async (ctx) => (await import("./doses")).snoozeDose(ctx, parse(id, doseId), parse(z.number().int(), minutes)));
}

// ---------- estoque (Lote 2) ----------

export async function registerPurchaseAction(medicationId: string, qty: number) {
  return run(async (ctx) => (await import("./stock")).registerPurchase(ctx, parse(id, medicationId), parse(quantity, qty)));
}
export async function adjustStockAction(medicationId: string, newBalance: number, reason: string) {
  return run(async (ctx) => (await import("./stock")).adjustStock(ctx, parse(id, medicationId), parse(quantity, newBalance), parse(optText(120), reason)));
}
export async function saveNoticeSettingsAction(input: unknown) {
  return run(async (ctx) => {
    const i = parse(
      z.object({
        leadDays: z.number().int().optional(),
        lateAfterMin: z.number().int().optional(),
        missedAfterMin: z.number().int().optional(),
        exceptions: z.array(z.object({ medicationId: id, days: z.number().int().nullable() })).max(100).optional(),
      }).strict(),
      input,
    );
    await (await import("./stock")).saveNoticeSettings(ctx, i);
  });
}

// ---------- receitas (Lote 3) ----------

const draftSchema = z.object({
  patientId: id,
  date: z.string().max(10),
  doctor: optText(120),
  specialty: optText(80),
  medicationIds: z.array(id).min(1, "Escolha pelo menos um remédio desta receita.").max(30),
  validity: z.enum(["30", "60", "180", "none"]),
  notes: optText(1000),
  controlled: z.boolean().optional(),
  copies: z.number().int().min(1).max(9).optional(),
  replacesId: id.nullish(),
  editId: id.nullish(),
});

/** Anexar/editar receita: FormData com `draft` (JSON) e `files` (as páginas: foto ou PDF). Os bytes sobem ao bucket privado do Appwrite. */
export async function saveRxAction(form: FormData): Promise<ActionResult<string>> {
  return run(async (ctx) => {
    const draft = parse(draftSchema, JSON.parse(String(form.get("draft") ?? "{}")));
    const raw = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (raw.length > 20) throw new (await import("./errors")).UserError("No máximo 20 páginas por receita.");
    const files = await Promise.all(raw.map(async (f) => ({ bytes: Buffer.from(await f.arrayBuffer()) })));
    return (await import("./prescriptions")).saveRx(ctx, draft, files);
  });
}
export async function deleteRxAction(rxId: string) {
  return run(async (ctx) => (await import("./prescriptions")).deleteRx(ctx, parse(id, rxId)));
}
export async function restoreRxAction(rxId: string) {
  return run(async (ctx) => (await import("./prescriptions")).restoreRx(ctx, parse(id, rxId)));
}
export async function markSupersededAction(rxId: string) {
  return run(async (ctx) => (await import("./prescriptions")).markSuperseded(ctx, parse(id, rxId)));
}
/** Compartilhar dentro do portal (o envio pelo WhatsApp é do Lote 4). */
export async function shareRxAction(rxId: string, target: { memberIds: string[] }) {
  return run(async (ctx) => (await import("./prescriptions")).shareRx(ctx, parse(id, rxId), parse(z.array(id).min(1).max(30), target.memberIds)));
}

// ---------- reposição (Lote 3) ----------

export async function assumeReplenishmentAction(medicationId: string, takeOver = false) {
  return run(async (ctx) => (await import("./replenishment")).claim(ctx, parse(id, medicationId), { takeOver: parse(z.boolean(), takeOver) }));
}
export async function advanceReplenishmentAction(medicationId: string, qty?: number) {
  return run(async (ctx) => (await import("./replenishment")).completeStep(ctx, parse(id, medicationId), qty === undefined ? {} : { quantity: parse(quantity, qty) }));
}
export async function cancelReplenishmentAction(medicationId: string) {
  return run(async (ctx) => (await import("./replenishment")).cancel(ctx, parse(id, medicationId)));
}

// ---------- avisos do sino (Lote 2) ----------

export async function markNoticesReadAction(ids?: string[]) {
  return run(async (ctx) => (await import("./notices")).markNoticesRead(ctx, ids === undefined ? undefined : parse(z.array(id).max(100), ids)));
}

// ---------- consultas (não devolvem o retrato) ----------

export type QueryResult<T> = { ok: true; data: T } | { ok: false; message: string; unauthorized?: boolean };

async function query<T>(fn: (ctx: import("./access").Ctx) => Promise<T>): Promise<QueryResult<T>> {
  const [{ getContext }, { UserError, ForbiddenError }] = await Promise.all([import("./access"), import("./errors")]);
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: "Sua sessão expirou. Entre de novo.", unauthorized: true };
  try {
    return { ok: true, data: await fn(ctx) };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: "Seu perfil não tem permissão para fazer isso." };
    if (e instanceof UserError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Confira os dados informados." };
    console.error("[query] falhou", (e as Error).name, (e as { code?: unknown }).code ?? "");
    return { ok: false, message: "Não foi possível concluir. Tente de novo." };
  }
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Registro de quem viu a receita; não devolve o retrato (a tela não recarrega ao abrir o visualizador). */
export async function recordRxViewAction(rxId: string) {
  return query(async (ctx) => (await import("./prescriptions")).recordView(ctx, parse(id, rxId)));
}

export async function loadDoseHistoryAction(filters: unknown) {
  return query(async (ctx) => {
    const f = parse(
      z.object({
        patientId: id.optional(), medicationId: id.optional(), memberId: id.optional(), from: ymd.optional(), to: ymd.optional(),
        status: z.enum(["pending", "taken", "late", "missed", "skipped"]).optional(),
      }).strict(),
      filters,
    );
    return (await import("./doses")).listDoseHistory(ctx, f);
  });
}

export async function previewStockDaysAction(medicationId: string, delta: number) {
  return query(async (ctx) => (await import("./stock")).previewStockDays(ctx, parse(id, medicationId), parse(z.number().finite().min(-100_000).max(100_000), delta)));
}

const memberInput = z.object({
  name: name(),
  phone: z.string().max(40),
  profileName: name(60),
  relation: optText(60),
  kind: z.enum(["email", "whatsapp"]).optional(),
  email: z.string().trim().toLowerCase().max(160).optional(),
});

const toResult = (o: import("./members").InviteOutcome): InviteResult => ({
  kind: o.kind,
  memberName: o.memberName,
  ...(o.emailSent !== undefined ? { emailSent: o.emailSent } : {}),
  ...(o.code ? { code: o.code } : {}),
  ...(o.expectedPhone ? { expectedPhone: o.expectedPhone } : {}),
  expiresLabel: o.expiresLabel,
});

export async function inviteMemberAction(input: unknown) {
  return run(async (ctx) => {
    const i = parse(memberInput, input);
    const m = await import("./members");
    if ((i.kind ?? "email") === "email") {
      const email = parse(z.string().email("Confira o e-mail."), i.email ?? "");
      return toResult(await m.inviteByEmail(ctx, { kind: "email", name: i.name, email, profileName: i.profileName, relation: i.relation }, await deps()));
    }
    return toResult(await m.inviteByWhatsapp(ctx, { kind: "whatsapp", name: i.name, phone: i.phone, profileName: i.profileName, relation: i.relation }));
  });
}

export async function updateMemberAction(memberId: string, input: unknown) {
  return run(async (ctx) => {
    const i = parse(memberInput.pick({ name: true, profileName: true, relation: true }), input);
    await (await import("./members")).updateMember(ctx, parse(id, memberId), { name: i.name, profileName: i.profileName, relation: i.relation });
  });
}

export async function removeMemberAction(memberId: string) {
  return run(async (ctx) => (await import("./members")).deactivateMember(ctx, parse(id, memberId), await deps()));
}
export async function reactivateMemberAction(memberId: string) {
  return run(async (ctx) => (await import("./members")).reactivateMember(ctx, parse(id, memberId), await deps()));
}
export async function revokeInviteAction(memberId: string) {
  return run(async (ctx) => (await import("./members")).revokeInvite(ctx, parse(id, memberId)));
}

/** Reenvia o e-mail (convite por e-mail) ou gera um novo código (convite por WhatsApp). */
export async function resendInviteAction(memberId: string) {
  return run(async (ctx) => {
    const mid = parse(id, memberId);
    const m = await import("./members");
    const { withFamilia } = await import("@medcuidar/pg");
    const s = await import("@medcuidar/pg/schema");
    const { and, eq, isNull } = await import("drizzle-orm");
    const kind = await withFamilia(ctx.familyId, async (tx) => {
      const [inv] = await tx.select({ kind: s.invites.kind }).from(s.invites).where(and(eq(s.invites.memberId, mid), isNull(s.invites.consumedAt), isNull(s.invites.revokedAt)));
      return inv?.kind;
    });
    if (kind === "whatsapp") return toResult(await m.regenerateWhatsappCode(ctx, mid));
    return toResult(await m.resendEmailInvite(ctx, mid, await deps()));
  });
}

export async function saveMyPhoneAction(phone: string) {
  return run(async (ctx) => (await import("./members")).saveMyPhone(ctx, parse(z.string().max(40), phone)));
}

// ---------- perfis ----------

export async function setPermissionAction(rowId: string, profile: string, value: boolean) {
  return run(async (ctx) =>
    (await import("./profiles")).setPermission(ctx, parse(z.string().max(40), rowId), parse(name(60), profile), parse(z.boolean(), value)),
  );
}

// ---------- pacientes ----------

const patientInput = z.object({
  id: id.optional(),
  name: name(),
  birthDate: z.string().refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && v <= new Date().toISOString().slice(0, 10) && v >= "1900-01-01"), "Confira a data de nascimento."),
  notes: optText(500),
  usesPhone: z.boolean(),
  selfMemberId: id.nullable(),
});

export async function savePatientAction(input: unknown) {
  return run(async (ctx) => (await import("./patients")).savePatient(ctx, parse(patientInput, input)));
}
export async function deletePatientAction(patientId: string) {
  return run(async (ctx) => (await import("./patients")).deletePatient(ctx, parse(id, patientId)));
}

// ---------- remédios e esquemas ----------

const route = z.string().refine((v) => v in ROUTE_BY_LABEL, "Tipo de uso inválido.").transform((v) => ROUTE_BY_LABEL[v]!);
const unit = z.string().refine((v) => v in UNIT_BY_LABEL, "Unidade inválida.").transform((v) => UNIT_BY_LABEL[v]!);
const alternatives = z.array(name(60)).max(10);
const drops = z.number().finite().positive().max(200);

export async function createMedicationAction(input: unknown) {
  return run(async (ctx) => {
    const i = parse(z.object({ patientId: id, name: name(), alternatives, routeLabel: route, unitLabel: unit, dropsPerMl: drops.optional(), initialStock: quantity.optional(), requiresPrescription: z.boolean().optional() }), input);
    return (await import("./medications")).createMedication(ctx, {
      patientId: i.patientId, name: i.name, alternatives: i.alternatives, route: i.routeLabel, controlUnit: i.unitLabel, ...(i.dropsPerMl ? { dropsPerMl: i.dropsPerMl } : {}), ...(i.initialStock ? { initialStock: i.initialStock } : {}),
      ...(i.requiresPrescription !== undefined ? { requiresPrescription: i.requiresPrescription } : {}),
    });
  });
}

export async function updateMedicationAction(medicationId: string, patch: unknown) {
  return run(async (ctx) => {
    const p = parse(z.object({ name: name().optional(), alternatives: alternatives.optional(), routeLabel: route.optional(), unitLabel: unit.optional(), dropsPerMl: drops.optional(), requiresPrescription: z.boolean().optional() }).strict(), patch);
    await (await import("./medications")).updateMedication(ctx, parse(id, medicationId), {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.alternatives !== undefined ? { alternatives: p.alternatives } : {}),
      ...(p.routeLabel !== undefined ? { route: p.routeLabel } : {}),
      ...(p.unitLabel !== undefined ? { controlUnit: p.unitLabel } : {}),
      ...(p.dropsPerMl !== undefined ? { dropsPerMl: p.dropsPerMl } : {}),
      ...(p.requiresPrescription !== undefined ? { requiresPrescription: p.requiresPrescription } : {}),
    });
  });
}

export async function deleteMedicationAction(medicationId: string) {
  return run(async (ctx) => (await import("./medications")).deleteMedication(ctx, parse(id, medicationId)));
}
export async function restoreMedicationAction(medicationId: string) {
  return run(async (ctx) => (await import("./medications")).restoreMedication(ctx, parse(id, medicationId)));
}

const phaseInput = z.object({
  order: z.number().int().optional(),
  everyHours: z.number().finite(),
  fromDay: z.number().int(),
  toDay: z.number().int().nullable(),
  perDose: z.number().finite(),
});

export async function saveSchemeAction(medicationId: string, input: unknown) {
  return run(async (ctx) => {
    const i = parse(
      z.object({
        single: z.boolean(),
        firstTime: z.string().max(5),
        phases: z.array(phaseInput).min(1).max(6),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      input,
    );
    const phases = (i.single ? [{ ...i.phases[0]!, fromDay: 1, toDay: null }] : i.phases).map((p) => ({ everyHours: p.everyHours, fromDay: p.fromDay, toDay: p.toDay, perDose: p.perDose }));
    await (await import("./medications")).saveScheme(ctx, parse(id, medicationId), { firstTime: i.firstTime, phases, ...(i.startDate ? { startDate: i.startDate } : {}) });
  });
}
