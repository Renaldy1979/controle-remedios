import "server-only";
import { and, eq } from "drizzle-orm";
import { withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";

/**
 * Contexto da conversa de UMA pessoa: o que "1", "2" e "3" querem dizer agora. Há quatro "perguntas" possíveis e, por pessoa, só uma vale
 * de cada vez (prioridade nesta ordem), para o número nunca ser ambíguo:
 *  1. `um`: o fluxo "um por um" (dose por dose: 1 Tomei · 2 Lembrar daqui a 15 min · 3 Não vou tomar);
 *  2. `choose`: lista numerada de doses/remédios a escolher (quando "tomei" tem várias doses de horários/pacientes diferentes);
 *  3. `grupo`: o lembrete de VÁRIOS remédios juntos (1 Tomei todos · 2 Um por um · 3 Lembrar daqui a 15 min);
 *  4. `doseIds`/`medIds`: lembretes de uma dose só ("1 Tomei · 2 Lembrar") e avisos de estoque ("1 Eu cuido disso").
 * Uma linha por pessoa (`conversation_state`); expira sozinho (grupo e um-por-um valem 2 h; escolha 30 min; o resto 6 h).
 */
export interface UmPorUm {
  /** doses ainda a perguntar, na ordem (a primeira é a da pergunta em aberto) */
  fila: string[];
  feitos: Array<{ id: string; remedio: string; r: "tomou" | "lembrar" | "pulou"; hora?: string }>;
  paciente: string;
  hora: string;
}
export interface GrupoCtx {
  ids: string[];
  /** lembrete de dose ESQUECIDA enviado à família: só "1 — Já tomou todos" vale */
  esquecida?: boolean;
}
export interface ConvCtx {
  /** doses que receberam lembrete e esperam resposta */
  doseIds: string[];
  /** remédios com aviso de estoque baixo/reposição que esperam "eu cuido disso" */
  medIds: string[];
  /** lista numerada em aberto */
  choose?: { acao: "tomei" | "lembrar" | "cuido"; ids: string[] };
  grupo?: GrupoCtx;
  um?: UmPorUm;
}

const VAZIO: ConvCtx = { doseIds: [], medIds: [] };
export const TTL_LEMBRETE_MS = 6 * 3600_000;
export const TTL_ESCOLHA_MS = 30 * 60_000;
export const TTL_MENU_MS = 2 * 3600_000;
const MAX_ITENS = 12;

interface Guardado {
  doseIds?: string[];
  medIds?: string[];
  choose?: ConvCtx["choose"];
  chooseUntil?: string;
  grupo?: GrupoCtx;
  grupoUntil?: string;
  um?: UmPorUm;
  umUntil?: string;
}

const vivo = (ate: string | undefined, now: Date) => Date.parse(String(ate ?? "")) > now.getTime();

export async function lerContexto(tx: Tx, memberId: string, now: Date): Promise<ConvCtx> {
  const [r] = await tx.select().from(s.conversationState).where(eq(s.conversationState.memberId, memberId));
  if (!r || r.expiresAt <= now) return { ...VAZIO, doseIds: [], medIds: [] };
  const d = r.data as Guardado;
  return {
    doseIds: d.doseIds ?? [],
    medIds: d.medIds ?? [],
    ...(d.choose && vivo(d.chooseUntil, now) ? { choose: d.choose } : {}),
    ...(d.grupo && vivo(d.grupoUntil, now) ? { grupo: d.grupo } : {}),
    ...(d.um && vivo(d.umUntil, now) ? { um: d.um } : {}),
  };
}

export async function gravarContexto(tx: Tx, familyId: string, memberId: string, ctx: ConvCtx, now: Date, ttlMs = TTL_LEMBRETE_MS): Promise<void> {
  const data: Record<string, unknown> = {
    doseIds: ctx.doseIds.slice(-MAX_ITENS), medIds: ctx.medIds.slice(-MAX_ITENS),
    ...(ctx.choose ? { choose: ctx.choose, chooseUntil: new Date(now.getTime() + TTL_ESCOLHA_MS).toISOString() } : {}),
    ...(ctx.grupo ? { grupo: ctx.grupo, grupoUntil: new Date(now.getTime() + TTL_MENU_MS).toISOString() } : {}),
    ...(ctx.um ? { um: ctx.um, umUntil: new Date(now.getTime() + TTL_MENU_MS).toISOString() } : {}),
  };
  const expiresAt = new Date(now.getTime() + ttlMs);
  await tx
    .insert(s.conversationState)
    .values({ familyId, memberId, kind: "ctx", data, expiresAt, updatedAt: now })
    .onConflictDoUpdate({ target: [s.conversationState.familyId, s.conversationState.memberId], set: { data, expiresAt, updatedAt: now } });
}

/** O que um lembrete/aviso entregue acrescenta ao contexto da pessoa. */
export interface AdicaoCtx {
  doseId?: string;
  medicationId?: string;
  grupo?: GrupoCtx;
}

/** Do `kind` e do `context` de uma linha de `outbound_messages` para o que o "1/2/3" da pessoa passa a significar. */
export function adicaoDeMensagem(kind: string, context: Record<string, unknown>, temOpcoes: boolean): AdicaoCtx {
  const doseId = context["doseId"];
  const medicationId = context["medicationId"];
  const ids = Array.isArray(context["doseIds"]) ? (context["doseIds"] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (context["grupo"] === true && ids.length > 0) return { grupo: { ids, ...(kind === "dose_missed" ? { esquecida: true } : {}) } };
  return {
    ...(typeof doseId === "string" && kind === "dose_reminder" ? { doseId } : {}),
    ...(typeof medicationId === "string" && temOpcoes ? { medicationId } : {}),
  };
}

/** Junta lembretes/avisos novos ao contexto da pessoa (chamado quando o lembrete é entregue para envio). */
export async function lembrarNoContexto(familyId: string, memberId: string, add: AdicaoCtx, now: Date): Promise<void> {
  await withFamilia(familyId, async (tx) => {
    const cur = await lerContexto(tx, memberId, now);
    const next: ConvCtx = {
      doseIds: add.doseId && !cur.doseIds.includes(add.doseId) ? [...cur.doseIds, add.doseId] : cur.doseIds,
      medIds: add.medicationId && !cur.medIds.includes(add.medicationId) ? [...cur.medIds, add.medicationId] : cur.medIds,
      // um lembrete de GRUPO novo vira a pergunta em aberto: apaga menus antigos para "1/2/3" nunca ficar ambíguo
      ...(add.grupo ? { grupo: add.grupo } : cur.grupo ? { grupo: cur.grupo } : {}),
      ...(add.grupo ? {} : cur.choose ? { choose: cur.choose } : {}),
      ...(add.grupo ? {} : cur.um ? { um: cur.um } : {}),
    };
    await gravarContexto(tx, familyId, memberId, next, now);
  });
}

export async function apagarContexto(tx: Tx, memberId: string): Promise<void> {
  await tx.delete(s.conversationState).where(and(eq(s.conversationState.memberId, memberId)));
}
