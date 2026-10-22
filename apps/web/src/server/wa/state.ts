import "server-only";
import { and, eq } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";

/**
 * Contexto da conversa de UMA pessoa: o que "1" e "2" querem dizer agora. Lembretes enviados (doses a confirmar),
 * avisos de estoque baixo (remédios a assumir) e, quando houve ambiguidade, a lista numerada que a pessoa está
 * respondendo. Uma linha por pessoa (`conversation_state`); expira sozinho.
 */
export interface ConvCtx {
  /** doses que receberam lembrete e esperam resposta */
  doseIds: string[];
  /** remédios com aviso de estoque baixo/reposição que esperam "eu cuido disso" */
  medIds: string[];
  /** lista numerada em aberto */
  choose?: { acao: "tomei" | "lembrar" | "cuido"; ids: string[] };
}

const VAZIO: ConvCtx = { doseIds: [], medIds: [] };
export const TTL_LEMBRETE_MS = 6 * 3600_000;
export const TTL_ESCOLHA_MS = 30 * 60_000;
const MAX_ITENS = 12;

export async function lerContexto(tx: Tx, memberId: string, now: Date): Promise<ConvCtx> {
  const [r] = await tx.select().from(s.conversationState).where(eq(s.conversationState.memberId, memberId));
  if (!r || r.expiresAt <= now) return { ...VAZIO, doseIds: [], medIds: [] };
  const d = r.data as Partial<ConvCtx>;
  const choose = d.choose && Date.parse(String((r.data as { chooseUntil?: string }).chooseUntil ?? "")) > now.getTime() ? d.choose : undefined;
  return { doseIds: d.doseIds ?? [], medIds: d.medIds ?? [], ...(choose ? { choose } : {}) };
}

export async function gravarContexto(tx: Tx, familyId: string, memberId: string, ctx: ConvCtx, now: Date, ttlMs = TTL_LEMBRETE_MS): Promise<void> {
  const data = {
    doseIds: ctx.doseIds.slice(-MAX_ITENS), medIds: ctx.medIds.slice(-MAX_ITENS),
    ...(ctx.choose ? { choose: ctx.choose, chooseUntil: new Date(now.getTime() + TTL_ESCOLHA_MS).toISOString() } : {}),
  };
  const expiresAt = new Date(now.getTime() + ttlMs);
  await tx
    .insert(s.conversationState)
    .values({ familyId, memberId, kind: "ctx", data, expiresAt, updatedAt: now })
    .onConflictDoUpdate({ target: [s.conversationState.familyId, s.conversationState.memberId], set: { data, expiresAt, updatedAt: now } });
}

/** Junta lembretes/avisos novos ao contexto da pessoa (chamado quando a API entrega a mensagem para envio). */
export async function lembrarNoContexto(
  familyId: string, memberId: string, add: { doseId?: string; medicationId?: string }, now: Date,
): Promise<void> {
  await withFamilia(familyId, async (tx) => {
    const cur = await lerContexto(tx, memberId, now);
    const next: ConvCtx = {
      doseIds: add.doseId && !cur.doseIds.includes(add.doseId) ? [...cur.doseIds, add.doseId] : cur.doseIds,
      medIds: add.medicationId && !cur.medIds.includes(add.medicationId) ? [...cur.medIds, add.medicationId] : cur.medIds,
      ...(cur.choose ? { choose: cur.choose } : {}),
    };
    await gravarContexto(tx, familyId, memberId, next, now);
  });
}

export async function apagarContexto(tx: Tx, memberId: string): Promise<void> {
  await tx.delete(s.conversationState).where(and(eq(s.conversationState.memberId, memberId)));
}
