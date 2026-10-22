import "server-only";
import { eq } from "drizzle-orm";
import { gerarCodigoVerificacao, hashCodigoVerificacao, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { normalizePhone } from "@/lib/phone";
import { audit } from "../pg/audit";
import { UserError } from "../pg/errors";
import { stampLabel } from "../pg/stamp";

/** O código vale 15 minutos (docs/06 seção 3). */
export const VALIDADE_CODIGO_MS = 15 * 60_000;

export interface MeuWhatsapp {
  verificado: string;
  pendente: string;
  /** quando o código atual expira (nulo = sem código ativo) */
  codigoExpiraEm: Date | null;
  tentativas: number;
}

export async function meuWhatsapp(actor: { familyId: string; memberId: string }, now: Date = new Date()): Promise<MeuWhatsapp> {
  return withFamilia(actor.familyId, async (tx) => {
    const [m] = await tx.select().from(s.members).where(eq(s.members.id, actor.memberId));
    const vivo = m?.verificationCodeHash && m.verificationExpiresAt && m.verificationExpiresAt > now && m.verificationAttempts < 5;
    return {
      verificado: m?.phoneVerified ?? "",
      pendente: m?.phonePending ?? "",
      codigoExpiraEm: vivo ? m!.verificationExpiresAt : null,
      tentativas: m?.verificationAttempts ?? 0,
    };
  });
}

/**
 * Informa o número da própria conta e gera o código de 6 dígitos (só o hash fica no banco, 15 min, 5 tentativas).
 * Um código novo invalida o anterior. Trocar o número derruba o verificado (gatilho do banco). O dono do número
 * envia o código ao WhatsApp do sistema; só então o número fica verificado (`verify_pending_phone`).
 */
export async function startPhoneVerification(
  actor: { familyId: string; memberId: string; timezone: string }, rawPhone: string, now: Date = new Date(),
): Promise<{ code: string; phone: string; expiresAt: Date; expiresLabel: string }> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
  const code = gerarCodigoVerificacao();
  const expiresAt = new Date(now.getTime() + VALIDADE_CODIGO_MS);
  await withFamilia(actor.familyId, async (tx) => {
    const [m] = await tx.select().from(s.members).where(eq(s.members.id, actor.memberId));
    if (!m) throw new UserError("Pessoa não encontrada.");
    if (m.phoneVerified === phone) throw new UserError("Este número já está verificado.");
    await tx
      .update(s.members)
      .set({ phonePending: phone, verificationCodeHash: hashCodigoVerificacao(code), verificationExpiresAt: expiresAt, verificationAttempts: 0 })
      .where(eq(s.members.id, actor.memberId));
    await audit(tx, actor, "member.phone_code", "member", actor.memberId, {});
  });
  return { code, phone, expiresAt, expiresLabel: stampLabel(expiresAt, actor.timezone).slice(-5) };
}
