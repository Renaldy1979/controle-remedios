import "server-only";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts, zonedToUtc } from "@medcuidar/domain";
import { custoMicros, formatarUsd, microsDeUsd, type TokensUso } from "./precos";

/**
 * Uso e custo de IA por família, com limite mensal. Só medição: uma linha por chamada (`ai_usage`), sem conteúdo de mensagem.
 * O limite padrão vem de `AI_MONTHLY_LIMIT_USD` (padrão 5); cada família pode ter o seu em `family_integrations.ai_monthly_limit_micros`.
 */
export const LIMITE_PADRAO_USD = 5;

export const limitePadraoMicros = (): number => {
  const v = Number((process.env["AI_MONTHLY_LIMIT_USD"] ?? "").replace(",", "."));
  return microsDeUsd(Number.isFinite(v) && v >= 0 && process.env["AI_MONTHLY_LIMIT_USD"] ? v : LIMITE_PADRAO_USD);
};

export interface RegistroUso {
  familyId: string;
  memberId: string | null;
  operacao: "conversa" | "audio" | "imagem";
  provedor: "anthropic" | "google";
  modelo: string;
  msgId: string;
  tokens: TokensUso;
  /** chave de idempotência da chamada (medir de novo não duplica) */
  idem: string;
  agora?: Date;
}

/** Grava o uso. Nunca lança: medir não pode atrapalhar a conversa. */
export async function registrarUso(r: RegistroUso): Promise<void> {
  try {
    const c = custoMicros(r.modelo, r.tokens);
    await withFamilia(r.familyId, (tx) =>
      tx.insert(s.aiUsage).values({
        familyId: r.familyId, memberId: r.memberId, operation: r.operacao, provider: r.provedor, model: r.modelo.replace(/^models\//, ""), msgId: r.msgId,
        inputTokens: r.tokens.entrada, cacheWriteTokens: r.tokens.cacheEscrita ?? 0, cacheReadTokens: r.tokens.cacheLeitura ?? 0,
        outputTokens: r.tokens.saida, mediaTokens: r.tokens.midia ?? 0, costMicros: c.micros, estimated: c.estimado, idemKey: r.idem,
        ...(r.agora ? { createdAt: r.agora } : {}),
      }).onConflictDoNothing());
  } catch {
    /* medir nunca atrapalha */
  }
}

/** Início do mês corrente no fuso da família (UTC) e o rótulo `aaaa-mm`. */
export function inicioDoMes(agora: Date, tz: string): { inicio: Date; mes: string } {
  const { date } = localParts(agora, tz);
  return { inicio: zonedToUtc(`${date.slice(0, 7)}-01`, 0, tz), mes: date.slice(0, 7) };
}

export interface ResumoUso {
  mes: string;
  usadoMicros: number;
  limiteMicros: number;
  chamadas: number;
  excedeu: boolean;
}

export async function resumoDeUso(familyId: string, tz: string, agora: Date = new Date()): Promise<ResumoUso> {
  const { inicio, mes } = inicioDoMes(agora, tz);
  return withFamilia(familyId, async (tx) => {
    const [u] = await tx
      .select({ micros: sql<number>`coalesce(sum(${s.aiUsage.costMicros}), 0)::float8`, n: sql<number>`count(*)::int` })
      .from(s.aiUsage).where(gte(s.aiUsage.createdAt, inicio));
    const [fi] = await tx.select({ lim: s.familyIntegrations.aiMonthlyLimitMicros }).from(s.familyIntegrations).where(eq(s.familyIntegrations.familyId, familyId));
    const limite = fi?.lim ?? limitePadraoMicros();
    const usado = Math.round(u?.micros ?? 0);
    return { mes, usadoMicros: usado, limiteMicros: limite, chamadas: u?.n ?? 0, excedeu: usado >= limite };
  });
}

/** Troca o limite mensal da família (em US$). Só o Administrador chama (a ação do portal confere). */
export async function definirLimiteMensal(familyId: string, usd: number): Promise<void> {
  const micros = microsDeUsd(usd);
  await withFamilia(familyId, (tx) =>
    tx.insert(s.familyIntegrations).values({ familyId, aiMonthlyLimitMicros: micros })
      .onConflictDoUpdate({ target: s.familyIntegrations.familyId, set: { aiMonthlyLimitMicros: micros, aiLimitNotifiedMonth: null, updatedAt: new Date() } }));
}

/**
 * Avisa os administradores (sino do portal) que o limite do mês estourou, uma vez por mês. Idempotente
 * (`notifications` tem `dedupe_key` único por família e `ai_limit_notified_month` evita refazer o trabalho).
 */
export async function avisarLimiteEstourado(familyId: string, resumo: ResumoUso, agora: Date = new Date()): Promise<void> {
  await withFamilia(familyId, async (tx) => {
    const [fi] = await tx.select({ m: s.familyIntegrations.aiLimitNotifiedMonth }).from(s.familyIntegrations).where(eq(s.familyIntegrations.familyId, familyId));
    if (fi?.m === resumo.mes) return;
    const admins = await tx
      .select({ id: s.members.id })
      .from(s.members)
      .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
      .where(and(eq(s.members.active, true), isNull(s.members.removedAt), eq(s.profiles.name, "Administrador")));
    const corpo = `O assistente de perguntas do WhatsApp chegou ao limite do mês (${formatarUsd(resumo.usadoMicros)} de ${formatarUsd(resumo.limiteMicros)}) e ficou pausado. Confirmar dose, estoque e próximas doses continuam funcionando. Você pode aumentar o limite em Configurações › WhatsApp.`;
    for (const a of admins) {
      await tx.insert(s.notifications).values({
        familyId, memberId: a.id, kind: "reply", title: "Assistente de perguntas pausado", body: corpo,
        payload: { alerta: "ia_limite", mes: resumo.mes }, dedupeKey: `ai-limit:${resumo.mes}:${a.id}`, createdAt: agora,
      }).onConflictDoNothing();
    }
    await tx.insert(s.familyIntegrations).values({ familyId, aiLimitNotifiedMonth: resumo.mes })
      .onConflictDoUpdate({ target: s.familyIntegrations.familyId, set: { aiLimitNotifiedMonth: resumo.mes, updatedAt: agora } });
  });
}
