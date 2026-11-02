import "server-only";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { DELETION_GRACE_DAYS, PRIVACY_VERSION } from "@/lib/privacy";
import { audit } from "./audit";
import { ForbiddenError, UserError } from "./errors";
import { isAdmin, type Actor } from "./guard";

/** LGPD (Lote 5B, docs/13): aceite da política, exportar e pedir/cancelar a exclusão da família. */

type Quem = Pick<Actor, "familyId" | "memberId">;

/** Registra que a pessoa leu e aceitou a versão vigente da política. */
export async function acceptPrivacy(who: Quem): Promise<void> {
  await withFamilia(who.familyId, async (tx) => {
    await tx.update(s.members).set({ privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION }).where(eq(s.members.id, who.memberId));
    await audit(tx, who, "privacy.accept", "member", who.memberId, { version: PRIVACY_VERSION });
  });
}

const normaliza = (t: string) => t.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");

/**
 * Pede a exclusão da família: só o Administrador, digitando o nome da família. A família fica bloqueada e é apagada de vez
 * depois de `DELETION_GRACE_DAYS` dias (a rotina diária); até lá o Administrador pode cancelar.
 */
export async function requestFamilyDeletion(actor: Actor, nomeDigitado: string): Promise<{ dueAt: Date }> {
  if (!isAdmin(actor)) throw new ForbiddenError("family.delete");
  return withFamilia(actor.familyId, async (tx) => {
    const [fam] = await tx.select({ name: s.families.name, deletedAt: s.families.deletedAt }).from(s.families).where(eq(s.families.id, actor.familyId));
    if (!fam) throw new UserError("Família não encontrada.");
    if (fam.deletedAt) throw new UserError("A exclusão já está agendada.");
    if (normaliza(nomeDigitado) !== normaliza(fam.name)) throw new UserError("O nome digitado não confere com o nome da família.");
    const now = new Date();
    await tx.update(s.families).set({ deletedAt: now, deletionRequestedBy: actor.memberId }).where(eq(s.families.id, actor.familyId));
    await audit(tx, actor, "family.delete_request", "family", actor.familyId, { graceDays: DELETION_GRACE_DAYS });
    return { dueAt: new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000) };
  });
}

/** Cancela a exclusão agendada (Administrador). */
export async function cancelFamilyDeletion(actor: Actor): Promise<void> {
  if (!isAdmin(actor)) throw new ForbiddenError("family.delete");
  await withFamilia(actor.familyId, async (tx) => {
    const done = await tx.update(s.families).set({ deletedAt: null, deletionRequestedBy: null }).where(eq(s.families.id, actor.familyId)).returning({ id: s.families.id });
    if (done.length === 0) throw new UserError("Família não encontrada.");
    await audit(tx, actor, "family.delete_cancel", "family", actor.familyId);
  });
}

/** Colunas que nunca saem na exportação: hashes de chave, de código e de token. */
const SEGREDOS: Record<string, string[]> = {
  members: ["verificationCodeHash", "verificationExpiresAt", "verificationAttempts", "appwriteUserId"],
  api_keys: ["keyHash"],
  invites: ["codeHash", "tokenHash"],
  first_access_links: ["tokenHash"],
};

function limpa<T extends Record<string, unknown>>(tabela: string, linhas: T[]): Array<Record<string, unknown>> {
  const fora = SEGREDOS[tabela] ?? [];
  return linhas.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => !fora.includes(k))));
}

/**
 * Todos os dados da família num objeto só (Administrador). Sem hashes de chave, código ou token. Filas e rascunhos de conversa
 * (mensagens a enviar, estado da conversa) não entram: não são dados cadastrados. As fotos das receitas continuam na tela de receitas.
 */
export async function exportFamilyData(actor: Actor): Promise<Record<string, unknown>> {
  if (!isAdmin(actor)) throw new ForbiddenError("family.export");
  return withFamilia(actor.familyId, async (tx) => {
    const dados = {
      familia: limpa("families", await tx.select().from(s.families)),
      perfis: limpa("profiles", await tx.select().from(s.profiles)),
      pessoas: limpa("members", await tx.select().from(s.members)),
      pacientes: limpa("patients", await tx.select().from(s.patients)),
      responsaveis: limpa("care_assignments", await tx.select().from(s.careAssignments)),
      remedios: limpa("medications", await tx.select().from(s.medications)),
      tratamentos: limpa("treatments", await tx.select().from(s.treatments)),
      fases: limpa("treatment_phases", await tx.select().from(s.treatmentPhases)),
      doses: limpa("dose_events", await tx.select().from(s.doseEvents)),
      estoque: limpa("stock_items", await tx.select().from(s.stockItems)),
      movimentos_de_estoque: limpa("stock_movements", await tx.select().from(s.stockMovements)),
      receitas: limpa("prescriptions", await tx.select().from(s.prescriptions)),
      arquivos_das_receitas: limpa("prescription_files", await tx.select().from(s.prescriptionFiles)),
      itens_das_receitas: limpa("prescription_items", await tx.select().from(s.prescriptionItems)),
      compartilhamentos_de_receitas: limpa("prescription_shares", await tx.select().from(s.prescriptionShares)),
      consultas_de_receitas: limpa("prescription_views", await tx.select().from(s.prescriptionViews)),
      reposicoes: limpa("replenishments", await tx.select().from(s.replenishments)),
      passos_da_reposicao: limpa("replenishment_steps", await tx.select().from(s.replenishmentSteps)),
      avisos: limpa("notifications", await tx.select().from(s.notifications)),
      auditoria: limpa("audit_log", await tx.select().from(s.auditLog)),
    };
    await audit(tx, actor, "family.export", "family", actor.familyId, { tabelas: Object.keys(dados).length });
    return { exportadoEm: new Date().toISOString(), versaoDoFormato: 1, ...dados };
  });
}
