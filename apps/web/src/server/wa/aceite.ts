import "server-only";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { PRIVACY_VERSION } from "@/lib/privacy";
import { appUrl } from "../env";
import { audit } from "../pg/audit";

/**
 * Quem só usa o WhatsApp não passa pela tela de aceite do portal: ao confirmar o número, a mensagem de boas-vindas traz o link da
 * política e este aceite fica registrado (membro + versão + auditoria). Se a pessoa depois entrar no portal, não precisa aceitar de novo.
 */
export async function registrarAceiteWhatsapp(familiaId: string, membroId: string): Promise<void> {
  await withFamilia(familiaId, async (tx) => {
    await tx.update(s.members).set({ privacyAcceptedAt: new Date(), privacyVersion: PRIVACY_VERSION }).where(eq(s.members.id, membroId));
    await audit(tx, { familyId: familiaId, memberId: membroId }, "privacy.accept", "member", membroId, { version: PRIVACY_VERSION, via: "whatsapp" });
  });
}

/** Endereço público da política, ou undefined se APP_URL não estiver definida. */
export function linkDaPolitica(): string | undefined {
  try {
    return `${appUrl()}/privacidade`;
  } catch {
    return undefined;
  }
}
