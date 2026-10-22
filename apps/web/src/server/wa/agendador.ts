import "server-only";
import { lt } from "drizzle-orm";
import { tentarTravaConsultiva, withFamilia, listarFamiliasAtivas, type TravaConsultiva } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { monitorarInstancia } from "./alertas";
import { logWa } from "./log";
import type { ProvedorWhatsapp } from "./provider/types";
import { relogioReal, type Relogio, type Ritmo } from "./ritmo";
import { gravarRuntime } from "./runtime";
import { enviarPendentes } from "./saida";

/**
 * Agendador de lembretes e avisos (lembrete de dose, esquecida, estoque baixo, receita vencendo, reposição, resumo diário), no mesmo
 * servidor do portal. Só UMA instância roda por vez: quem consegue a TRAVA CONSULTIVA do Postgres (de sessão) é o líder; se o processo
 * cair, a conexão fecha e outra instância assume no próximo ciclo. Cada ciclo: consulta a instância (alerta se desconectada), gera e
 * envia o que está na hora (`saida.ts`) e, de tempos em tempos, apaga a memória antiga do agente.
 */
export const NOME_TRAVA = "medcuidar-wa-agendador";
export const INTERVALO_PADRAO_MS = 30_000;

export interface DepsAgendador {
  provedor: ProvedorWhatsapp;
  ritmo: Ritmo;
  relogio?: Relogio;
  agora?: () => Date;
  intervaloMs?: number;
  /** só para teste/simulador: limita o ciclo a uma família */
  somenteFamilia?: string;
  /** para teste: troca a aquisição da trava */
  tentarTrava?: () => Promise<TravaConsultiva | null>;
}

/** Um ciclo do líder. Devolve false se esta instância não é a líder. */
export async function cicloAgendador(d: DepsAgendador, estado: { trava: TravaConsultiva | null; ultimaLimpeza: number; ultimoMonitor: number }): Promise<boolean> {
  const agora = d.agora?.() ?? new Date();
  if (estado.trava && !(await estado.trava.aindaMinha())) {
    await estado.trava.liberar();
    estado.trava = null;
  }
  if (!estado.trava) estado.trava = await (d.tentarTrava ?? (() => tentarTravaConsultiva(NOME_TRAVA)))();
  if (!estado.trava) return false;

  await gravarRuntime("worker", { em: agora.toISOString(), lider: true, provedor: d.provedor.id }, agora);
  if (agora.getTime() - estado.ultimoMonitor >= 60_000) {
    estado.ultimoMonitor = agora.getTime();
    await monitorarInstancia(d.provedor, agora);
  }
  const r = await enviarPendentes(d.provedor, d.ritmo, { ...(d.agora ? { agora: d.agora } : {}), ...(d.somenteFamilia ? { somenteFamilia: d.somenteFamilia } : {}) });
  if (r.enviadas || r.falhas || r.ambiguas) logWa({ etapa: "agendador", ...r });
  if (agora.getTime() - estado.ultimaLimpeza >= 10 * 60_000) {
    estado.ultimaLimpeza = agora.getTime();
    await limparMemoriaDoAgente(agora);
  }
  return true;
}

/** Memória do agente parada há mais de 24 h é apagada (dado de saúde: não fica mais do que precisa). */
export async function limparMemoriaDoAgente(agora: Date): Promise<void> {
  const corte = new Date(agora.getTime() - 24 * 3600_000);
  for (const f of await listarFamiliasAtivas()) {
    await withFamilia(f.familiaId, (tx) => tx.delete(s.agentSessions).where(lt(s.agentSessions.updatedAt, corte))).catch(() => {});
  }
}

export interface Agendador {
  parar(): Promise<void>;
}

export function iniciarAgendador(d: DepsAgendador): Agendador {
  const relogio = d.relogio ?? relogioReal;
  const estado = { trava: null as TravaConsultiva | null, ultimaLimpeza: 0, ultimoMonitor: 0 };
  let parando = false;
  const laco = (async () => {
    while (!parando) {
      try {
        await cicloAgendador(d, estado);
      } catch (e) {
        logWa({ etapa: "agendador_erro", erro: e instanceof Error ? e.name : "erro" });
      }
      await relogio.dormir(d.intervaloMs ?? INTERVALO_PADRAO_MS);
    }
  })();
  return {
    parar: async () => {
      parando = true;
      await Promise.race([laco, new Promise((r) => setTimeout(r, 2000))]);
      await estado.trava?.liberar();
    },
  };
}
