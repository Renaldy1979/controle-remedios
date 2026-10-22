import "server-only";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { eq } from "drizzle-orm";
import { logWa } from "./log";
import { variantesBr } from "./provider/telefone";
import { ErroEnvio, type ProvedorWhatsapp } from "./provider/types";
import type { Ritmo } from "./ritmo";

/**
 * Para onde mandar um lembrete a um celular brasileiro, que no WhatsApp pode estar COM ou SEM o 9 depois do DDD:
 *  1. se já sabemos a forma que funcionou (`members.whatsapp_send_number`, aprendida ao receber uma mensagem dele ou num envio), usa essa;
 *  2. senão pergunta ao provedor "este número está no WhatsApp?" (`numeroNoWhatsapp`) e usa o número devolvido;
 *  3. se a consulta não existe ou falha, tenta a forma cadastrada e, em caso de "número inexistente" (recusa clara, nada saiu),
 *     faz UMA retentativa com a outra forma. Como a primeira tentativa falhou com clareza, nunca duplica a mensagem.
 * Guarda no membro a forma que funcionou. Tudo isolado aqui; o provedor só responde às perguntas.
 */
export interface DestinoMembro {
  familiaId: string;
  membroId: string;
  /** número verificado, como cadastrado */
  telefone: string;
  /** forma que funcionou da última vez */
  numeroEnvio: string | null;
}

async function guardar(d: DestinoMembro, numero: string): Promise<void> {
  try {
    await withFamilia(d.familiaId, (tx) => tx.update(s.members).set({ whatsappSendNumber: numero }).where(eq(s.members.id, d.membroId)));
  } catch {
    /* só otimização */
  }
}

/** Envia e devolve o número (a forma) que funcionou. */
export async function enviarAoMembro(provedor: ProvedorWhatsapp, ritmo: Ritmo, d: DestinoMembro, texto: string): Promise<string> {
  const formas = variantesBr(d.telefone);
  const conhecida = d.numeroEnvio && formas.includes(d.numeroEnvio) ? d.numeroEnvio : null;
  let primario = conhecida ?? d.telefone;

  if (!conhecida && formas.length > 1) {
    const r = await provedor.numeroNoWhatsapp(d.telefone).catch(() => null);
    if (r?.existe && formas.includes(r.numero)) primario = r.numero;
    else if (r && !r.existe) {
      const outra = formas.find((f) => f !== d.telefone)!;
      const r2 = await provedor.numeroNoWhatsapp(outra).catch(() => null);
      if (r2?.existe) primario = formas.includes(r2.numero) ? r2.numero : outra;
    }
  }
  const alternativa = formas.length > 1 ? formas.find((f) => f !== primario) : undefined;

  try {
    await ritmo.enviar(provedor, primario, texto);
  } catch (e) {
    if (!(e instanceof ErroEnvio && e.numeroInexistente && alternativa)) throw e;
    logWa({ etapa: "envio_outra_variante", membro: d.membroId });
    await ritmo.enviar(provedor, alternativa, texto);
    await guardar(d, alternativa);
    return alternativa;
  }
  if (primario !== d.numeroEnvio && formas.length > 1) await guardar(d, primario);
  return primario;
}
