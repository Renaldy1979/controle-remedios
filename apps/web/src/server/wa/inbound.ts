import "server-only";
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { withPlataforma } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import type { MensagemRecebida } from "./provider/types";

/**
 * Fila de ENTRADA do WhatsApp no Postgres (docs/06 seção 5). O webhook só grava (dedupe pelo id da mensagem) e responde 200; o worker
 * processa. Sem família (o remetente só é identificado no processamento): tudo roda em `withPlataforma`. O payload (texto, base64 de
 * mídia) e a resposta pronta são APAGADOS ao concluir; as linhas concluídas somem depois de RETENCAO_DIAS (LGPD).
 */
export const RETENCAO_DIAS = 7;
export const MAX_TENTATIVAS = 5;
export const TRAVA_MS = 5 * 60_000;

export interface FiltroReivindicar {
  /** só este item (simulador). Sem isso, mensagens `sim-*` ficam de fora. */
  somenteMsgId?: string;
}

export interface ItemEntrada {
  id: string;
  msgId: string;
  telefone: string;
  payload: MensagemRecebida | null;
  etapa: "novo" | "respondido" | "enviado";
  respostaTexto: string | null;
  respostaOrigem: string | null;
  tentativas: number;
}

/** Grava a mensagem na fila. A mesma mensagem (reenvio do webhook) é ignorada: devolve `novo: false`. */
export async function enfileirar(m: MensagemRecebida): Promise<{ novo: boolean }> {
  return withPlataforma(async (tx) => {
    const r = await tx
      .insert(s.whatsappInbound)
      .values({ msgId: m.msgId, phone: m.telefone, payload: m as unknown as Record<string, unknown> })
      .onConflictDoNothing({ target: s.whatsappInbound.msgId })
      .returning({ id: s.whatsappInbound.id });
    return { novo: r.length > 0 };
  });
}

interface Linha {
  id: string;
  msg_id: string;
  phone: string;
  payload: MensagemRecebida | null;
  stage: ItemEntrada["etapa"];
  response_text: string | null;
  response_origin: string | null;
  attempts: number;
}

/**
 * Pega o próximo item pronto, com FOR UPDATE SKIP LOCKED:
 *  - uma conversa por telefone por vez e EM ORDEM (só o item mais antigo de cada telefone é candidato; telefone com item em
 *    processamento ainda travado espera);
 *  - item "processando" com a trava vencida (queda do processo) volta a ser candidato;
 *  - respeita o recuo (`next_attempt_at`).
 * Os claims são serializados por uma trava curta de transação, para dois workers nunca pegarem itens do mesmo telefone.
 */
export async function reivindicar(agora = new Date(), filtro: FiltroReivindicar = {}): Promise<ItemEntrada | null> {
  const t = agora.toISOString();
  // o simulador do portal usa a MESMA fila, mas o worker real nunca pega as mensagens dele (e o simulador só pega a sua)
  const so = filtro.somenteMsgId ? sql`and f.msg_id = ${filtro.somenteMsgId}` : sql`and f.msg_id not like 'sim-%'`;
  return withPlataforma(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('medcuidar-wa-inbound-claim', 0))`);
    const alvo = (await tx.execute(sql`
      with candidatos as (
        select distinct on (f.phone) f.id
        from whatsapp_inbound f
        where (f.status = 'pendente' or (f.status = 'processando' and f.locked_until <= ${t}::timestamptz)) ${so}
        order by f.phone, f.created_at, f.id
      )
      select f.id from whatsapp_inbound f
      where f.id in (select id from candidatos)
        and f.next_attempt_at <= ${t}::timestamptz
        and not exists (select 1 from whatsapp_inbound p where p.phone = f.phone and p.status = 'processando' and p.locked_until > ${t}::timestamptz)
      order by f.created_at, f.id
      limit 1
      for update of f skip locked`)) as unknown as { id: string }[];
    if (!alvo[0]) return null;
    const r = (await tx.execute(sql`
      update whatsapp_inbound set status = 'processando', attempts = attempts + 1, locked_until = ${new Date(agora.getTime() + TRAVA_MS).toISOString()}::timestamptz
      where id = ${alvo[0].id}
      returning id, msg_id, phone, payload, stage, response_text, response_origin, attempts`)) as unknown as Linha[];
    const l = r[0]!;
    return {
      id: l.id, msgId: l.msg_id, telefone: l.phone, payload: l.payload, etapa: l.stage,
      respostaTexto: l.response_text, respostaOrigem: l.response_origin, tentativas: l.attempts,
    };
  });
}

/** Estende a trava de um item longo (modelo + ferramentas podem demorar). */
export async function renovarTrava(id: string, agora = new Date()): Promise<void> {
  await withPlataforma((tx) =>
    tx.update(s.whatsappInbound).set({ lockedUntil: new Date(agora.getTime() + TRAVA_MS) })
      .where(and(eq(s.whatsappInbound.id, id), eq(s.whatsappInbound.status, "processando"))));
}

/** A resposta ficou pronta: guarda o texto para a retentativa só reenviar (nunca refazer a conversa). */
export async function guardarResposta(id: string, texto: string, origem: string): Promise<void> {
  await withPlataforma((tx) => tx.update(s.whatsappInbound).set({ stage: "respondido", responseText: texto, responseOrigin: origem }).where(eq(s.whatsappInbound.id, id)));
}

/** Marca "enviado" ANTES de mandar: se o processo cair no meio do envio, a mensagem NÃO é reenviada (nunca responde duas vezes). */
export async function marcarEnviando(id: string): Promise<void> {
  await withPlataforma((tx) => tx.update(s.whatsappInbound).set({ stage: "enviado" }).where(eq(s.whatsappInbound.id, id)));
}

/** Envio recusado com erro CLARO pelo provedor: volta a "respondido" para tentar de novo. */
export async function desfazerEnvio(id: string): Promise<void> {
  await withPlataforma((tx) => tx.update(s.whatsappInbound).set({ stage: "respondido" }).where(and(eq(s.whatsappInbound.id, id), eq(s.whatsappInbound.stage, "enviado"))));
}

/** Concluído: apaga o payload (inclui base64 de mídia) e a resposta pronta. */
export async function concluir(id: string, agora = new Date()): Promise<void> {
  await withPlataforma((tx) =>
    tx.update(s.whatsappInbound).set({
      status: "feito", stage: "enviado", payload: null, responseText: null, lockedUntil: null, errorSummary: null, finishedAt: agora,
    }).where(eq(s.whatsappInbound.id, id)));
}

/** Recuo exponencial: 30 s, 1 min, 2 min, 4 min… (teto de 10 min). */
export const esperaRecuoMs = (tentativas: number) => Math.min(30_000 * 2 ** Math.max(tentativas - 1, 0), 10 * 60_000);

/** Falha: tenta de novo com recuo; esgotadas as tentativas o item vira `erro` (sem payload), com motivo curto SEM conteúdo de mensagem. */
export async function falhar(item: Pick<ItemEntrada, "id" | "tentativas">, motivo: string, agora = new Date()): Promise<"pendente" | "erro"> {
  const resumo = motivo.replace(/\s+/g, " ").replace(/\d{8,}/g, "…").slice(0, 200);
  return withPlataforma(async (tx) => {
    if (item.tentativas >= MAX_TENTATIVAS) {
      await tx.update(s.whatsappInbound).set({ status: "erro", payload: null, responseText: null, lockedUntil: null, errorSummary: resumo, finishedAt: agora }).where(eq(s.whatsappInbound.id, item.id));
      return "erro" as const;
    }
    await tx.update(s.whatsappInbound).set({
      status: "pendente", lockedUntil: null, errorSummary: resumo, nextAttemptAt: new Date(agora.getTime() + esperaRecuoMs(item.tentativas)),
    }).where(eq(s.whatsappInbound.id, item.id));
    return "pendente" as const;
  });
}

/** Retenção: apaga as linhas concluídas (feito/erro) com mais de RETENCAO_DIAS. */
export async function limparEntrada(agora = new Date()): Promise<number> {
  const corte = new Date(agora.getTime() - RETENCAO_DIAS * 86_400_000);
  const r = await withPlataforma((tx) =>
    tx.delete(s.whatsappInbound).where(and(inArray(s.whatsappInbound.status, ["feito", "erro"]), lt(s.whatsappInbound.finishedAt, corte))).returning({ id: s.whatsappInbound.id }));
  return r.length;
}

export interface ResumoEntrada {
  pendentes: number;
  processando: number;
  erros: number;
  maisAntigaSeg: number | null;
  ultimosErros: Array<{ motivo: string; quando: Date; tentativas: number }>;
}

/** Números para o painel do portal: nada de telefone nem de conteúdo. */
export async function resumoEntrada(agora = new Date()): Promise<ResumoEntrada> {
  return withPlataforma(async (tx) => {
    const cont = await tx.select({ status: s.whatsappInbound.status, n: count() }).from(s.whatsappInbound).groupBy(s.whatsappInbound.status);
    const n = (st: string) => Number(cont.find((c) => c.status === st)?.n ?? 0);
    const [antiga] = await tx.select({ em: sql<Date | null>`min(${s.whatsappInbound.createdAt})` }).from(s.whatsappInbound).where(eq(s.whatsappInbound.status, "pendente"));
    const erros = await tx
      .select({ motivo: s.whatsappInbound.errorSummary, quando: s.whatsappInbound.finishedAt, tentativas: s.whatsappInbound.attempts })
      .from(s.whatsappInbound).where(eq(s.whatsappInbound.status, "erro")).orderBy(desc(s.whatsappInbound.finishedAt)).limit(5);
    return {
      pendentes: n("pendente"), processando: n("processando"), erros: n("erro"),
      maisAntigaSeg: antiga?.em ? Math.max(0, Math.round((agora.getTime() - new Date(antiga.em).getTime()) / 1000)) : null,
      ultimosErros: erros.map((e) => ({ motivo: e.motivo ?? "sem detalhe", quando: e.quando ?? agora, tentativas: e.tentativas })),
    };
  });
}
