import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { listarFamiliasAtivas, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { logWa } from "./log";
import { gravarRuntime, lerRuntime, type EstadoEnvio, type EstadoInstancia } from "./runtime";
import type { ProvedorWhatsapp } from "./provider/types";

/**
 * Alertas operacionais do WhatsApp para os ADMINISTRADORES (sino do portal, `notifications` kind `reply` com `payload.alerta`):
 * instância desconectada (e quando volta) e envios falhando em sequência. Idempotentes: a `dedupe_key` inclui o instante em que o
 * problema começou, então o mesmo problema avisa uma vez só. Nada aqui leva telefone nem texto de mensagem.
 */
export const MINUTOS_ATE_ALERTAR_DESCONEXAO = 2;
export const FALHAS_SEGUIDAS_PARA_ALERTAR = 5;

/** Cria o aviso em todas as famílias ativas, para cada administrador. Devolve quantos avisos novos entraram. */
export async function alertarAdministradores(chave: string, titulo: string, corpo: string, alerta: string, agora: Date): Promise<number> {
  let novos = 0;
  for (const f of await listarFamiliasAtivas()) {
    try {
      novos += await withFamilia(f.familiaId, async (tx) => {
        const admins = await tx
          .select({ id: s.members.id })
          .from(s.members)
          .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
          .where(and(eq(s.members.active, true), isNull(s.members.removedAt), eq(s.profiles.name, "Administrador")));
        let n = 0;
        for (const a of admins) {
          const r = await tx.insert(s.notifications).values({
            familyId: f.familiaId, memberId: a.id, kind: "reply", title: titulo, body: corpo, payload: { alerta }, dedupeKey: `${chave}:${a.id}`, createdAt: agora,
          }).onConflictDoNothing().returning({ id: s.notifications.id });
          n += r.length;
        }
        return n;
      });
    } catch (e) {
      logWa({ etapa: "alerta_falhou", erro: e instanceof Error ? e.name : "erro" });
    }
  }
  return novos;
}

/**
 * Consulta a instância (conectada?) e alerta se ficou desconectada por mais de MINUTOS_ATE_ALERTAR_DESCONEXAO. Quando volta, avisa uma vez.
 * Resposta em formato desconhecido (`null`) não alerta. `agora` injetável.
 */
export async function monitorarInstancia(provedor: ProvedorWhatsapp, agora: Date = new Date()): Promise<EstadoInstancia> {
  const antes = await lerRuntime<EstadoInstancia>("instancia");
  let conectada: boolean | null;
  try {
    conectada = (await provedor.statusInstancia()).conectada;
  } catch {
    conectada = false; // sem resposta do provedor: tratamos como fora do ar
  }
  const mesmoEstado = antes && antes.conectada === conectada;
  const desde = mesmoEstado ? antes.desde : agora.toISOString();
  let alertada = mesmoEstado ? antes.alertada : false;

  if (conectada === false && !alertada && agora.getTime() - Date.parse(desde) >= MINUTOS_ATE_ALERTAR_DESCONEXAO * 60_000) {
    await alertarAdministradores(
      `wa-instancia:${desde}`, "WhatsApp do sistema desconectado",
      "O número de WhatsApp do MedCuidar está desconectado: ninguém está recebendo lembretes nem respostas. Abra Configurações › WhatsApp para ver o estado e reconecte o número (QR Code) na Evolution Go.",
      "wa_desconectado", agora,
    );
    alertada = true;
  }
  if (conectada === true && antes?.conectada === false && antes.alertada) {
    await alertarAdministradores(`wa-instancia-ok:${agora.toISOString()}`, "WhatsApp do sistema reconectado", "O número voltou a ficar conectado. Os lembretes e as respostas voltaram ao normal.", "wa_reconectado", agora);
  }
  const novo: EstadoInstancia = { conectada, desde, consultadaEm: agora.toISOString(), alertada };
  await gravarRuntime("instancia", novo, agora);
  return novo;
}

/** Conta falhas de envio SEGUIDAS (um sucesso zera). Ao chegar em FALHAS_SEGUIDAS_PARA_ALERTAR avisa os administradores, uma vez por sequência. */
export async function registrarResultadoEnvio(ok: boolean, agora: Date = new Date()): Promise<EstadoEnvio> {
  const antes = (await lerRuntime<EstadoEnvio>("envio")) ?? { falhasSeguidas: 0, alertada: false, desde: null };
  if (ok) {
    if (antes.falhasSeguidas === 0 && !antes.alertada) return antes;
    const zerado: EstadoEnvio = { falhasSeguidas: 0, alertada: false, desde: null };
    await gravarRuntime("envio", zerado, agora);
    return zerado;
  }
  const falhasSeguidas = antes.falhasSeguidas + 1;
  const inicio = antes.falhasSeguidas === 0 ? agora.toISOString() : (antes.desde ?? agora.toISOString());
  let alertada = antes.alertada;
  if (falhasSeguidas >= FALHAS_SEGUIDAS_PARA_ALERTAR && !alertada) {
    await alertarAdministradores(
      `wa-envio:${inicio}`, "Mensagens do WhatsApp não estão saindo",
      "Várias mensagens seguidas falharam ao enviar. Abra Configurações › WhatsApp para ver o motivo e confira se o número continua conectado.",
      "wa_envio_falhando", agora,
    );
    alertada = true;
  }
  const novo: EstadoEnvio = { falhasSeguidas, alertada, desde: antes.falhasSeguidas === 0 ? inicio : antes.desde };
  await gravarRuntime("envio", novo, agora);
  return novo;
}

/* ------------------------------------------------------------------ chave recusada (401/403) */

export const FALHAS_DE_CHAVE_PARA_PAUSAR = 3;
export const PAUSA_POR_CHAVE_MS = 10 * 60_000;

export interface EstadoAuth { falhas: number; pausadoAte: string | null; alertada: boolean; desde: string | null }

/** O envio está pausado por chave recusada? Devolve até quando (ou null). */
export async function envioPausadoPorChave(agora: Date = new Date()): Promise<Date | null> {
  const e = await lerRuntime<EstadoAuth>("auth");
  return e?.pausadoAte && Date.parse(e.pausadoAte) > agora.getTime() ? new Date(e.pausadoAte) : null;
}

/**
 * A Evolution recusou a chave (401/403). Depois de FALHAS_DE_CHAVE_PARA_PAUSAR seguidas, PAUSA o envio por 10 min (depois tenta de novo)
 * e avisa os administradores no sino, UMA vez por sequência. Devolve a pausa, se houver.
 */
export async function registrarFalhaDeChave(agora: Date = new Date()): Promise<Date | null> {
  const antes = (await lerRuntime<EstadoAuth>("auth")) ?? { falhas: 0, pausadoAte: null, alertada: false, desde: null };
  const emPausa = antes.pausadoAte && Date.parse(antes.pausadoAte) > agora.getTime();
  const falhas = emPausa ? antes.falhas : antes.falhas + 1;
  const desde = antes.desde ?? agora.toISOString();
  let pausadoAte = emPausa ? antes.pausadoAte : null;
  let alertada = antes.alertada;
  if (!emPausa && falhas >= FALHAS_DE_CHAVE_PARA_PAUSAR) {
    pausadoAte = new Date(agora.getTime() + PAUSA_POR_CHAVE_MS).toISOString();
    if (!alertada) {
      await alertarAdministradores(
        `wa-auth:${desde}`, "WhatsApp do sistema: chave recusada",
        "A Evolution Go recusou a chave (401): use o token da instância em EVOLUTION_INSTANCE_TOKEN (Evolution Go › instância › token), no EasyPanel, e faça Deploy. O envio ficou pausado e tenta de novo em 10 minutos.",
        "wa_chave_recusada", agora,
      );
      alertada = true;
    }
    // zera a contagem para a próxima rodada (depois da pausa): mais 3 falhas pausam de novo, sem novo aviso
    await gravarRuntime("auth", { falhas: 0, pausadoAte, alertada, desde }, agora);
    return new Date(pausadoAte);
  }
  await gravarRuntime("auth", { falhas, pausadoAte, alertada, desde }, agora);
  return pausadoAte ? new Date(pausadoAte) : null;
}

/** Um envio deu certo: a chave está boa. Zera a contagem, a pausa e o aviso. */
export async function registrarChaveBoa(agora: Date = new Date()): Promise<void> {
  const e = await lerRuntime<EstadoAuth>("auth");
  if (!e || (e.falhas === 0 && !e.pausadoAte && !e.alertada)) return;
  await gravarRuntime("auth", { falhas: 0, pausadoAte: null, alertada: false, desde: null }, agora);
}
