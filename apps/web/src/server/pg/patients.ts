import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { audit } from "./audit";
import { UserError } from "./errors";
import { requirePermission, type Actor } from "./guard";

export interface PatientData {
  /** sem id = novo paciente */
  id?: string;
  name: string;
  /** aaaa-mm-dd ou vazio */
  birthDate: string;
  notes: string;
  usesPhone: boolean;
  /** o paciente também é usuário (ex.: Adelino) */
  selfMemberId: string | null;
  /** Declaração de que tem autorização da pessoa ou é o responsável por ela (LGPD, docs/13). A Server Action a exige ao cadastrar. */
  dataAuthorized?: boolean;
}

/** Cria ou edita um paciente. Devolve o id. */
export async function savePatient(actor: Actor, input: PatientData): Promise<string> {
  requirePermission(actor, "patients.manage");
  return withFamilia(actor.familyId, async (tx) => {
    if (input.selfMemberId) {
      const [m] = await tx.select({ id: s.members.id, active: s.members.active }).from(s.members).where(eq(s.members.id, input.selfMemberId));
      if (!m || !m.active) throw new UserError("Essa pessoa não está na família ou está desativada.");
      const taken = await tx
        .select({ id: s.patients.id })
        .from(s.patients)
        .where(and(eq(s.patients.selfMemberId, input.selfMemberId), isNull(s.patients.deletedAt), input.id ? ne(s.patients.id, input.id) : undefined));
      if (taken.length) throw new UserError("Essa pessoa já está ligada a outro paciente.");
    }
    const values = {
      name: input.name,
      birthDate: input.birthDate || null,
      notes: input.notes.trim() || null,
      canUsePhone: input.usesPhone,
      selfMemberId: input.selfMemberId,
    };
    const declaracao = { dataAuthorizedAt: new Date(), dataAuthorizedBy: actor.memberId };
    if (input.id) {
      const [atual] = await tx.select({ authorizedAt: s.patients.dataAuthorizedAt }).from(s.patients).where(and(eq(s.patients.id, input.id), isNull(s.patients.deletedAt)));
      if (!atual) throw new UserError("Paciente não encontrado.");
      // quem já declarou não perde a declaração; paciente antigo (sem ela) passa a ter ao marcar
      await tx.update(s.patients).set({ ...values, ...(input.dataAuthorized && !atual.authorizedAt ? declaracao : {}) }).where(eq(s.patients.id, input.id));
      await audit(tx, actor, "patient.update", "patient", input.id);
      return input.id;
    }
    const [row] = await tx.insert(s.patients).values({ ...values, ...declaracao, familyId: actor.familyId }).returning({ id: s.patients.id });
    await audit(tx, actor, "patient.create", "patient", row!.id);
    return row!.id;
  });
}

/** Arquiva o paciente (o histórico fica guardado). */
export async function deletePatient(actor: Actor, patientId: string): Promise<void> {
  requirePermission(actor, "patients.manage");
  await withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .update(s.patients)
      .set({ deletedAt: new Date(), active: false })
      .where(and(eq(s.patients.id, patientId), isNull(s.patients.deletedAt)))
      .returning({ id: s.patients.id });
    if (!rows.length) throw new UserError("Paciente não encontrado.");
    await audit(tx, actor, "patient.delete", "patient", patientId);
  });
}
