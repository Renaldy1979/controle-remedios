import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { withFamilia, withPlataforma } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { nucleoDoAmbiente } from "./boot";
import { enfileirar } from "./inbound";
import { criarFake } from "./provider";
import type { MensagemRecebida } from "./provider/types";
import { criarRitmo, type Relogio } from "./ritmo";
import { enviarPendentes } from "./saida";
import { rodarUmaVez } from "./worker";

/**
 * Simulador de WhatsApp do portal (só Administrador, só com SIMULATOR_ENABLED=1). Usa a MESMA fila (`whatsapp_inbound`) e o MESMO
 * código do worker (`rodarUmaVez`) e do núcleo da conversa; só troca o provedor por um `fake` por chamada. As mensagens do simulador
 * têm id `sim-*`: o worker real nunca as pega, e o simulador só pega a sua. NENHUMA mensagem real é enviada.
 */

/** Relógio do simulador: não espera de verdade (a pausa de 2 a 6 s é só contada), mas o resto do ritmo é o mesmo código. */
const relogioRapido = (): Relogio => ({ agora: () => Date.now(), dormir: async () => {}, aleatorio: () => Math.random() });

export interface RespostaSimulador {
  respostas: Array<{ texto: string }>;
  digitando: number;
}

export async function conversarNoSimulador(telefone: string, entrada: { texto?: string; acao?: string }): Promise<RespostaSimulador> {
  const msgId = `sim-${randomUUID()}`;
  const m: MensagemRecebida = {
    msgId, telefone, numeroResposta: telefone, tipo: entrada.acao ? "botao" : "texto", texto: entrada.texto ?? "", acao: entrada.acao ?? "", aviso: "",
    mime: "", base64: "", segundos: 0, midiaRef: null, idadeSegundos: 0,
  };
  await enfileirar(m);
  const fake = criarFake();
  // +5 s: o carimbo `next_attempt_at` vem do relógio do banco, que pode estar milissegundos à frente deste processo
  const deps = { agora: () => new Date(Date.now() + 5000), provedor: fake, ritmo: criarRitmo({ relogio: relogioRapido(), maxPorMinuto: 1000, maxPorHora: 10000 }), nucleo: nucleoDoAmbiente() };
  // o item pode precisar de mais de uma rodada se falhar e tentar de novo; aqui basta uma, e uma segunda cobre o caso de a primeira já ter concluído
  await rodarUmaVez(deps, { somenteMsgId: msgId });
  const estado = await withPlataforma(async (tx) => (await tx.select({ st: s.whatsappInbound.status, erro: s.whatsappInbound.errorSummary }).from(s.whatsappInbound).where(eq(s.whatsappInbound.msgId, msgId)))[0]);
  if (!estado || estado.st !== "feito") throw new Error("A mensagem não foi processada. Tente de novo.");
  return { respostas: fake.enviados.map((e) => ({ texto: e.texto })), digitando: fake.presencas.length };
}

/** Roda o agendador de verdade para UMA família, com o provedor fake. Devolve o que "saiu" (nome, telefone e texto). */
export async function enviarAgoraNoSimulador(familyId: string): Promise<Array<{ para: string; telefone: string; texto: string }>> {
  const fake = criarFake();
  await enviarPendentes(fake, criarRitmo({ relogio: relogioRapido(), maxPorMinuto: 1000, maxPorHora: 10000 }), { somenteFamilia: familyId });
  const nomes = await withFamilia(familyId, async (tx) => new Map((await tx.select({ n: s.members.name, t: s.members.phoneVerified }).from(s.members)).map((x) => [x.t ?? "", x.n])));
  return fake.enviados.map((e) => ({ para: nomes.get(e.numero) ?? "—", telefone: e.numero, texto: e.texto }));
}
