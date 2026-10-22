import "server-only";
import { eq } from "drizzle-orm";
import { withPlataforma } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";

/**
 * Estado do WhatsApp do SISTEMA (uma instância para todas as famílias), em `whatsapp_runtime` (RLS da plataforma):
 *  - `worker`: batimento do worker e do agendador (para o portal mostrar "ligado / desligado");
 *  - `instancia`: última consulta ao provedor (conectada?) e desde quando está assim;
 *  - `envio`: falhas de envio seguidas e se o alerta já foi dado.
 * Nada aqui contém telefone nem conteúdo de mensagem.
 */
export interface EstadoWorker { em: string; lider: boolean; provedor: string }
export interface EstadoInstancia { conectada: boolean | null; desde: string; consultadaEm: string; alertada: boolean }
export interface EstadoEnvio { falhasSeguidas: number; alertada: boolean; desde: string | null }

export async function lerRuntime<T>(chave: "worker" | "instancia" | "envio"): Promise<T | null> {
  const [r] = await withPlataforma((tx) => tx.select().from(s.whatsappRuntime).where(eq(s.whatsappRuntime.key, chave)));
  return (r?.value as T | undefined) ?? null;
}

export async function gravarRuntime(chave: "worker" | "instancia" | "envio", valor: object, agora = new Date()): Promise<void> {
  await withPlataforma((tx) =>
    tx.insert(s.whatsappRuntime).values({ key: chave, value: valor as Record<string, unknown>, updatedAt: agora })
      .onConflictDoUpdate({ target: s.whatsappRuntime.key, set: { value: valor as Record<string, unknown>, updatedAt: agora } }));
}
