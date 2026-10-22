import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { VALIDADE_CONVITE_MS, gerarTokenPrimeiroAcesso, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { audit } from "../pg/audit";
import { appUrl } from "../env";

/**
 * Cria o link de primeiro acesso (uso único, 24 h) de um membro `whatsapp_verified`; os links anteriores ainda não
 * usados deixam de valer. Só o hash fica no banco; o link completo existe só na mensagem devolvida/enviada.
 */
export async function issueFirstAccessLink(
  familyId: string, memberId: string, actorMemberId: string = memberId, action = "member.first_access_link",
): Promise<{ url: string; linkId: string }> {
  const t = gerarTokenPrimeiroAcesso();
  const expiresAt = new Date(Date.now() + VALIDADE_CONVITE_MS);
  const linkId = await withFamilia(familyId, async (tx) => {
    await tx
      .update(s.firstAccessLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(s.firstAccessLinks.memberId, memberId), isNull(s.firstAccessLinks.consumedAt), isNull(s.firstAccessLinks.revokedAt)));
    const [row] = await tx.insert(s.firstAccessLinks).values({ familyId, memberId, tokenHash: t.hash, expiresAt }).returning({ id: s.firstAccessLinks.id });
    await audit(tx, { familyId, memberId: actorMemberId }, action, "member", memberId, {});
    return row!.id;
  });
  return { url: `${appUrl()}/primeiro-acesso?t=${t.token}`, linkId };
}
