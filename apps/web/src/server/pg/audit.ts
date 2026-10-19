import "server-only";
import type { Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";

export type AuditMeta = Record<string, string | number | boolean | string[] | null>;

/**
 * Auditoria das ações administrativas: só ids, nomes de perfil e contagens. Nunca telefone, e-mail,
 * código de convite nem texto clínico livre (LGPD).
 */
export async function audit(
  tx: Tx,
  actor: { familyId: string; memberId: string },
  action: string,
  entity: string,
  entityId: string | null,
  meta: AuditMeta = {},
): Promise<void> {
  await tx.insert(s.auditLog).values({ familyId: actor.familyId, actorMemberId: actor.memberId, action, entity, entityId, meta });
}
