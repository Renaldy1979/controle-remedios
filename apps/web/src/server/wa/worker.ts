import "server-only";
import { registrarResultadoEnvio } from "./alertas";
import { concluir, desfazerEnvio, falhar, guardarResposta, limparEntrada, type FiltroReivindicar, marcarEnviando, reivindicar, renovarTrava, type ItemEntrada } from "./inbound";
import { logWa } from "./log";
import { processarEntrada, type DepsNucleo } from "./nucleo";
import type { ProvedorWhatsapp } from "./provider/types";
import { recusaClara, relogioReal, type Relogio, type Ritmo } from "./ritmo";
import * as T from "./texts";

/**
 * Worker da fila de ENTRADA (docs/06 seção 5). Um laço por processo (concorrência configurável); seguro com reinício: o item preso por
 * queda volta quando a trava vence. Garantias:
 *  - uma conversa por telefone por vez e EM ORDEM (a reivindicação em `inbound.ts`, com FOR UPDATE SKIP LOCKED);
 *  - a resposta é guardada ANTES de enviar e o item é marcado "enviado" ANTES do envio: a retentativa só reenvia o que ficou claro que
 *    não saiu, e queda no meio do envio nunca resulta em resposta duplicada;
 *  - falha vira nova tentativa com recuo, até MAX_TENTATIVAS; no fim o item vira `erro` e a pessoa recebe o aviso de instabilidade.
 */
export interface DepsWorker {
  provedor: ProvedorWhatsapp;
  nucleo: DepsNucleo;
  ritmo: Ritmo;
  relogio?: Relogio;
  agora?: () => Date;
}

export const SEPARADOR = "\u0001";

/** Processa um item reivindicado. Lança em falha (quem chama aplica o recuo). */
export async function processarItem(item: ItemEntrada, d: DepsWorker): Promise<void> {
  const t0 = Date.now();
  let respostas: string[] = item.respostaTexto ? item.respostaTexto.split(SEPARADOR) : [];

  if (item.etapa === "novo") {
    if (!item.payload) throw new Error("item sem payload");
    const batimento = () => renovarTrava(item.id);
    const r = await processarEntrada(item.payload, {
      ...d.nucleo, agente: { ...d.nucleo.agente, batimento }, ...(d.agora ? { agora: d.agora } : {}),
    });
    respostas = r.respostas;
    await guardarResposta(item.id, respostas.join(SEPARADOR), r.origem);
    logWa({ etapa: "respondido", msgId: item.msgId, origem: r.origem, intent: r.intent, ms: Date.now() - t0 });
  }

  if (item.etapa !== "enviado" && respostas.length > 0) {
    const numero = item.payload?.numeroResposta ?? item.telefone;
    await marcarEnviando(item.id);
    let enviadas = 0;
    try {
      for (const texto of respostas) {
        await d.ritmo.enviar(d.provedor, numero, texto);
        enviadas++;
      }
      if (d.provedor.id !== "fake") await registrarResultadoEnvio(true, d.agora?.() ?? new Date());
    } catch (e) {
      if (d.provedor.id !== "fake") await registrarResultadoEnvio(false, d.agora?.() ?? new Date()).catch(() => {});
      if (enviadas === 0 && recusaClara(e)) {
        await desfazerEnvio(item.id); // nada saiu: a retentativa pode reenviar sem duplicar
        throw e;
      }
      // algo pode ter saído (sem resposta do provedor, ou só parte das mensagens): NÃO reenviar. Conclui o item.
      logWa({ etapa: "envio_ambiguo", msgId: item.msgId, enviadas, erro: e instanceof Error ? e.name : "erro" });
    }
  }
  await concluir(item.id, d.agora?.());
  logWa({ etapa: "feito", msgId: item.msgId, ms: Date.now() - t0, tentativas: item.tentativas });
}

/** Trata a falha de um item: nova tentativa com recuo ou, esgotadas, `erro` + aviso de instabilidade (uma vez, só se nada foi enviado). */
export async function tratarFalha(item: ItemEntrada, e: unknown, d: DepsWorker): Promise<void> {
  const motivo = e instanceof Error ? `${e.name}: ${e.message}` : "falha desconhecida";
  const destino = await falhar(item, motivo, d.agora?.() ?? new Date());
  logWa({ etapa: "falha", msgId: item.msgId, tentativas: item.tentativas, destino, erro: motivo.slice(0, 120) });
  if (destino === "erro" && item.etapa !== "enviado") {
    try {
      await d.ritmo.enviar(d.provedor, item.payload?.numeroResposta ?? item.telefone, T.instabilidade().texto);
    } catch {
      /* melhor esforço */
    }
  }
}

/** Uma rodada: reivindica e processa no máximo um item. Devolve false se a fila estava vazia. */
export async function rodarUmaVez(d: DepsWorker, filtro?: FiltroReivindicar): Promise<boolean> {
  const item = await reivindicar(d.agora?.() ?? new Date(), filtro);
  if (!item) return false;
  try {
    await processarItem(item, d);
  } catch (e) {
    await tratarFalha(item, e, d);
  }
  return true;
}

export interface WorkerEntrada {
  parar(): Promise<void>;
}

/** Inicia os laços de entrada (e a limpeza periódica). Chamado uma vez por processo. */
export function iniciarWorkerEntrada(d: DepsWorker, opts: { concorrencia?: number; intervaloOciosoMs?: number } = {}): WorkerEntrada {
  const relogio = d.relogio ?? relogioReal;
  const n = Math.max(1, opts.concorrencia ?? 2);
  let parando = false;
  const laco = async () => {
    while (!parando) {
      try {
        const fez = await rodarUmaVez(d);
        if (!fez) await relogio.dormir(opts.intervaloOciosoMs ?? 1500);
      } catch (e) {
        logWa({ etapa: "worker_erro", erro: e instanceof Error ? e.name : "erro" });
        await relogio.dormir(5000); // banco fora do ar, etc.: espera e segue
      }
    }
  };
  const lacos = Array.from({ length: n }, () => laco());
  const limpar = async () => {
    try {
      await limparEntrada();
    } catch {
      /* tenta de novo na próxima */
    }
  };
  void limpar();
  const timer = setInterval(() => void limpar(), 10 * 60_000);
  timer.unref?.();
  return { parar: async () => { parando = true; clearInterval(timer); await Promise.allSettled(lacos); } };
}
