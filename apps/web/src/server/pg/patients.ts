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
    if (input.id) {
      const rows = await tx.update(s.patients).set(values).where(and(eq(s.patients.id, input.id), isNull(s.patients.deletedAt))).returning({ id: s.patients.id });
      if (!rows.length) throw new UserError("Paciente não encontrado.");
      await audit(tx, actor, "patient.update", "patient", input.id);
      return input.id;
    }
    const [row] = await tx.insert(s.patients).values({ ...values, familyId: actor.familyId }).returning({ id: s.patients.id });
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
