import postgres from "postgres";
import { appUrl } from "./env";

/**
 * Trava consultiva do Postgres de SESSÃO (pg_try_advisory_lock) numa conexão própria: quem a segura é o "líder" de uma tarefa que só
 * pode rodar numa instância por vez (ex.: o agendador de lembretes do WhatsApp). Se o processo cair, a conexão fecha e a trava é solta
 * sozinha. Não bloqueia: devolve null se outra instância já a tem.
 */
export interface TravaConsultiva {
  /** Confere se a conexão continua viva e a trava ainda é nossa. */
  aindaMinha(): Promise<boolean>;
  liberar(): Promise<void>;
}

/** Chave numérica estável a partir do nome (hash do próprio Postgres). */
export async function tentarTravaConsultiva(nome: string, url: string = appUrl()): Promise<TravaConsultiva | null> {
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, idle_timeout: 0, max_lifetime: null });
  try {
    const [r] = await sql<{ ok: boolean }[]>`select pg_try_advisory_lock(hashtextextended(${nome}, 0)) as ok`;
    if (!r?.ok) {
      await sql.end({ timeout: 1 });
      return null;
    }
  } catch (e) {
    await sql.end({ timeout: 1 }).catch(() => {});
    throw e;
  }
  return {
    async aindaMinha() {
      // trava de sessão: enquanto a conexão responde, a trava continua nossa
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
    async liberar() {
      try {
        await sql`select pg_advisory_unlock(hashtextextended(${nome}, 0))`;
      } catch { /* a conexão pode já ter caído */ }
      await sql.end({ timeout: 1 }).catch(() => {});
    },
  };
}
