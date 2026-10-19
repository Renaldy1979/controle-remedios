import "server-only";
import { localParts } from "@medcuidar/domain";
import type { FamilySettings } from "@medcuidar/shared";
import { ensureDosesForDay, refreshDoseStatuses } from "./doses";
import { evaluateLowStockForFamily } from "./stock";

/**
 * Deixa o dia da família em dia antes de montar a tela: gera as doses de hoje (idempotente), grava atraso/esquecida e
 * confere o estoque baixo. Chamado ao abrir o portal e na atualização periódica; o agendador/N8N dos próximos lotes
 * chama as mesmas funções (`ensureDosesForDay` etc.) sem precisar de ninguém com o portal aberto.
 */
export async function prepareDay(
  ctx: { familyId: string; timezone: string; settings: Pick<FamilySettings, "late_after_min" | "missed_after_min"> },
  now: Date = new Date(),
): Promise<void> {
  const { date } = localParts(now, ctx.timezone);
  await ensureDosesForDay(ctx.familyId, date);
  await refreshDoseStatuses(ctx.familyId, ctx.settings, now);
  await evaluateLowStockForFamily(ctx.familyId, now);
}

/** Como `prepareDay`, mas uma falha aqui (ex.: banco lento) nunca derruba a tela nem uma ação já concluída: só registra o código do erro. */
export async function prepareDaySafe(ctx: Parameters<typeof prepareDay>[0], now?: Date): Promise<void> {
  try {
    await prepareDay(ctx, now);
  } catch (e) {
    console.error("[prepare] falhou", (e as Error).name, (e as { code?: unknown }).code ?? "");
  }
}
