import "server-only";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { can } from "@medcuidar/shared";
import { resolveSender, type WaActor } from "./actor";
import { processarMensagem, remetenteDesconhecido, type ConversaEntrada } from "./conversa";
import { interpretText, normalizeText, type Intent } from "./interpret";
import { logWa } from "./log";
import { responderLivre, type DepsAgente } from "./ia/agente";
import { geminiModelo, type LeitorMidia } from "./ia/midia";
import { registrarUso } from "./ia/uso";
import type { MensagemRecebida } from "./provider/types";
import * as T from "./texts";

/**
 * NÚCLEO DA CONVERSA do WhatsApp (docs/06 seção 5): recebe uma mensagem normalizada do provedor e devolve os textos a responder.
 * É o ÚNICO caminho: o worker chama esta função direto (sem HTTP para si mesmo) e o simulador também.
 *   1. identifica o remetente pelo telefone VERIFICADO (senão: só aceita códigos; resposta genérica, sem registrar nada);
 *   2. PARAR / REATIVAR (por membro, sem modelo);
 *   3. conversa determinística (`conversa.ts`: confirmar dose, desfazer, lembrar de novo, "eu cuido disso", estoque, próximas doses...);
 *   4. só se nada casar (`livre`), o agente de IA, que apenas LÊ.
 * Áudio e foto viram TEXTO pelo Gemini (o Claude só recebe texto). Confirmar dose nunca passa por IA.
 */
export type OrigemResposta = "codigo" | "comando" | "conversa" | "agente" | "midia" | "recusa";

export interface RespostaNucleo {
  respostas: string[];
  origem: OrigemResposta;
  intent: string;
}

export interface DepsNucleo {
  agente: DepsAgente;
  /** null = sem GEMINI_API_KEY */
  midia: LeitorMidia | null;
  /** baixa a mídia quando o webhook não trouxe o conteúdo (o provedor sabe como) */
  baixarMidia?: (ref: Record<string, unknown>) => Promise<{ base64: string; mimetype: string } | null>;
  agora?: () => Date;
}

/* ------------------------------------------------------------------ PARAR / REATIVAR */

const PARAR = /^(parar|pare|sair|stop|parar avisos|pausar avisos|sair dos avisos|cancelar avisos)$/;
const REATIVAR = /^(reativar|reativar avisos|ativar avisos|voltar avisos|quero receber avisos|voltar)$/;

/** Só a MENSAGEM INTEIRA digitada (áudio e foto nunca viram comando). */
export function comandoDeAvisos(texto: string): "parar" | "reativar" | null {
  const t = normalizeText(texto);
  return PARAR.test(t) ? "parar" : REATIVAR.test(t) ? "reativar" : null;
}

export async function definirPausa(actor: WaActor, pausar: boolean, agora: Date): Promise<void> {
  await withFamilia(actor.familyId, async (tx) => {
    await tx.update(s.members).set({ whatsappOptOutAt: pausar ? agora : null }).where(eq(s.members.id, actor.memberId));
    await tx.insert(s.auditLog).values({ familyId: actor.familyId, actorMemberId: actor.memberId, action: pausar ? "member.whatsapp_stop" : "member.whatsapp_resume", entity: "member", entityId: actor.memberId, meta: {} });
  });
}

/* ------------------------------------------------------------------ mídia */

/** Ações que ALTERAM dados: por áudio transcrito (pode ter erro) não executam; pedem a confirmação por texto. */
const ESCRITAS: ReadonlySet<Intent> = new Set<Intent>(["dose_tomada", "lembrar_depois", "eu_cuido", "opcao", "nao_tomou"]);

const um = (r: T.Resposta, origem: OrigemResposta, intent: string): RespostaNucleo => ({ respostas: [r.texto], origem, intent });

async function lerMidia(actor: WaActor, m: MensagemRecebida, d: DepsNucleo, agora: Date): Promise<{ texto: string | null; aviso?: T.Resposta }> {
  let base64 = m.base64, mime = m.mime;
  if (!base64 && m.midiaRef && d.baixarMidia) {
    const baixada = await d.baixarMidia(m.midiaRef).catch(() => null);
    if (baixada) { base64 = baixada.base64; mime = baixada.mimetype || mime; }
  }
  if (!base64) return { texto: null, aviso: T.midiaNaoAbriu() };
  if (!d.midia) return { texto: null, aviso: m.tipo === "audio" ? T.audioNaoEntendido() : T.fotoNaoLida() };
  const t0 = Date.now();
  const lido = m.tipo === "audio" ? await d.midia.transcreverAudio(base64, mime, m.segundos) : await d.midia.lerImagem(base64, mime);
  logWa({ etapa: m.tipo, msgId: m.msgId, ms: Date.now() - t0, ok: !!lido.texto });
  if (lido.uso) {
    await registrarUso({
      familyId: actor.familyId, memberId: actor.memberId, operacao: m.tipo === "audio" ? "audio" : "imagem", provedor: "google", modelo: geminiModelo(), msgId: m.msgId,
      tokens: { entrada: lido.uso.entrada, saida: lido.uso.saida, midia: lido.uso.midia }, idem: `uso:${m.msgId}:${m.tipo}`, agora,
    });
  }
  return lido.texto ? { texto: lido.texto } : { texto: null, aviso: m.tipo === "audio" ? T.audioNaoEntendido() : T.fotoNaoLida() };
}

/* ------------------------------------------------------------------ uma mensagem */

async function agente(actor: WaActor, texto: string, msgId: string, d: DepsNucleo, origem: "texto" | "audio" | "imagem"): Promise<RespostaNucleo> {
  if (!can(actor.member, "whatsapp.query")) return um(T.semPermissao(), "conversa", "sem_permissao");
  const r = await responderLivre(actor, texto, msgId, d.agente, origem);
  return { respostas: [r.texto], origem: "agente", intent: `livre:${r.motivo}` };
}

/** Processa UMA mensagem recebida. Não envia nada. Erros de infraestrutura lançam (a fila tenta de novo). */
export async function processarEntrada(m: MensagemRecebida, d: DepsNucleo): Promise<RespostaNucleo> {
  const agora = (d.agora ?? (() => new Date()))();
  const actor = await resolveSender(m.telefone);

  // 1) remetente sem número verificado: só aceita códigos (texto). Mídia e o resto recebem a resposta genérica, sem custo.
  if (!actor) {
    const r = m.tipo === "texto" ? await remetenteDesconhecido(m.telefone, m.texto) : { respostas: [T.desconhecido()], intent: "desconhecido" as const };
    logWa({ etapa: "remetente", msgId: m.msgId, conhecido: false, intent: r.intent });
    return { respostas: r.respostas.map((x) => x.texto), origem: r.intent === "desconhecido" ? "recusa" : "codigo", intent: r.intent };
  }

  // 2) mídia recusada pelo provedor (grande demais...) e tipos que não entendemos
  if (m.tipo === "recusa") return um(m.aviso === "audio_longo" ? T.audioLongo() : m.aviso === "foto_grande" ? T.fotoGrande() : T.midiaNaoAbriu(), "midia", "midia_recusada");
  if (m.tipo === "outro") return um(T.pedeTexto(), "conversa", "tipo_nao_suportado");

  // 3) texto digitado e botões: PARAR/REATIVAR (sem modelo) e a conversa determinística
  if (m.tipo === "texto" || m.tipo === "botao") {
    const cmd = m.tipo === "texto" ? comandoDeAvisos(m.texto) : null;
    if (cmd) {
      await definirPausa(actor, cmd === "parar", agora);
      return um(cmd === "parar" ? T.avisosPausados() : T.avisosReativados(), "comando", cmd);
    }
    const entrada: ConversaEntrada = { telefone: m.telefone, messageId: m.msgId, now: agora, ...(m.texto ? { texto: m.texto } : {}), ...(m.acao ? { acao: m.acao as NonNullable<ConversaEntrada["acao"]> } : {}) };
    const r = await processarMensagem(actor, entrada);
    if (r.intent !== "livre") return { respostas: r.respostas.map((x) => x.texto), origem: "conversa", intent: r.intent };
    return agente(actor, m.texto, m.msgId, d, "texto");
  }

  // 4) áudio e foto: viram texto pelo Gemini
  await d.agente.batimento?.();
  const lido = await lerMidia(actor, m, d, agora);
  if (!lido.texto) return um(lido.aviso ?? T.midiaNaoAbriu(), "midia", "midia_falhou");

  if (m.tipo === "audio") {
    const intent = interpretText(lido.texto);
    if (ESCRITAS.has(intent)) {
      return um({ texto: `${T.titulo("🎙️", "Entendi seu áudio")}\nPara não errar, confirme por texto: escreva *tomei* (ou a opção) que eu anoto.` }, "midia", "audio_escrita_pede_texto");
    }
    if (intent !== "livre" && intent !== "codigo") {
      const r = await processarMensagem(actor, { telefone: m.telefone, messageId: m.msgId, now: agora, texto: lido.texto });
      if (r.intent !== "livre") return { respostas: r.respostas.map((x) => x.texto), origem: "conversa", intent: r.intent };
    }
    return agente(actor, lido.texto, m.msgId, d, "audio");
  }
  // foto: a leitura da imagem vai (com a legenda) para o agente; nada é confirmado a partir de foto
  return agente(actor, `Legenda: ${m.texto || "sem legenda"}\nO que a leitura da imagem encontrou: ${lido.texto}`, m.msgId, d, "imagem");
}
