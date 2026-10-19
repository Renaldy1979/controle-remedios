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

async function run<T>(fn: (ctx: import("./access").Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const [{ getContext }, { UserError, ForbiddenError }, { buildSnapshot }] = await Promise.all([
    import("./access"), import("./errors"), import("./snapshot"),
  ]);
  const ctx = await getContext();
  if (!ctx) return { ok: false, message: "Sua sessão expirou. Entre de novo.", unauthorized: true };
  try {
    const data = await fn(ctx);
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
    const i = parse(z.object({ patientId: id, name: name(), alternatives, routeLabel: route, unitLabel: unit, dropsPerMl: drops.optional() }), input);
    return (await import("./medications")).createMedication(ctx, {
      patientId: i.patientId, name: i.name, alternatives: i.alternatives, route: i.routeLabel, controlUnit: i.unitLabel, ...(i.dropsPerMl ? { dropsPerMl: i.dropsPerMl } : {}),
    });
  });
}

export async function updateMedicationAction(medicationId: string, patch: unknown) {
  return run(async (ctx) => {
    const p = parse(z.object({ name: name().optional(), alternatives: alternatives.optional(), routeLabel: route.optional(), unitLabel: unit.optional(), dropsPerMl: drops.optional() }).strict(), patch);
    await (await import("./medications")).updateMedication(ctx, parse(id, medicationId), {
      ...(p.name !== undefined ? { name: p.name } : {}),
      ...(p.alternatives !== undefined ? { alternatives: p.alternatives } : {}),
      ...(p.routeLabel !== undefined ? { route: p.routeLabel } : {}),
      ...(p.unitLabel !== undefined ? { controlUnit: p.unitLabel } : {}),
      ...(p.dropsPerMl !== undefined ? { dropsPerMl: p.dropsPerMl } : {}),
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
