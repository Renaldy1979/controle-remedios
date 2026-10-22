import "server-only";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts } from "@medcuidar/domain";
import type { WaActor } from "../actor";
import { logWa } from "../log";
import * as T from "../texts";
import { executarFerramenta } from "./ferramentas";
import { MAX_TOKENS_RESPOSTA, modeloConfigurado, type BlocoConteudo, type ChamarModelo, type MensagemModelo, type PedidoModelo } from "./modelo";
import { FERRAMENTAS_AGENTE, PROMPT_AGENTE } from "./prompt";
import { avisarLimiteEstourado, registrarUso, resumoDeUso } from "./uso";

/**
 * Agente de IA (Claude) para texto livre (`intent: "livre"`). Só LEITURA: as ferramentas (`ferramentas.ts`) rodam em processo, dentro de
 * `withFamilia`, com as permissões do membro identificado; confirmar dose, desfazer, comprar e qualquer escrita NUNCA passam por aqui.
 *
 * Prompt caching: `system` e `tools` são constantes (iguais para todas as famílias); o que varia (data, hora, quem fala, a pergunta)
 * vai só nas mensagens. O último bloco de cada chamada leva `cache_control` para o laço de ferramentas reaproveitar o prefixo.
 */
export const MAX_ITERACOES = 6;
export const MAX_TOKENS_MENSAGEM = 60_000;
const TURNOS_MEMORIA = 6;
const MEMORIA_TTL_MS = 6 * 3600_000;
const MAX_TEXTO_TURNO = 600;

export interface DepsAgente {
  /** null = sem ANTHROPIC_API_KEY */
  modelo: ChamarModelo | null;
  agora?: () => Date;
  /** chamado antes de cada passo demorado (estende a trava do item na fila) */
  batimento?: () => Promise<void>;
  maxIteracoes?: number;
}

export interface RespostaAgente {
  texto: string;
  /** o que aconteceu, para o log e para os testes */
  motivo: "ok" | "indisponivel" | "pausado" | "erro_modelo" | "recusa" | "limite_iteracoes" | "resposta_longa" | "vazia";
}

/** Pedido à Messages API: system e tools constantes; só as mensagens variam. */
export function montarPedido(mensagens: MensagemModelo[], modelo = modeloConfigurado()): PedidoModelo {
  const ms = mensagens.slice();
  const ult = ms[ms.length - 1]!;
  const blocos: BlocoConteudo[] = typeof ult.content === "string" ? [{ type: "text", text: ult.content }] : ult.content;
  ms[ms.length - 1] = { ...ult, content: blocos.map((b, i, a) => (i === a.length - 1 ? { ...b, cache_control: { type: "ephemeral" } } : b)) };
  return {
    model: modelo,
    max_tokens: MAX_TOKENS_RESPOSTA,
    system: [{ type: "text", text: PROMPT_AGENTE, cache_control: { type: "ephemeral" } }],
    tools: FERRAMENTAS_AGENTE,
    messages: ms,
    output_config: { effort: "low" },
  };
}

/** Contexto variável que acompanha a pergunta (nunca no system, para não quebrar o cache). */
function contexto(actor: WaActor, agora: Date, origem: "texto" | "audio" | "imagem"): string {
  const { date, minutes } = localParts(agora, actor.timezone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0"), mm = String(minutes % 60).padStart(2, "0");
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: actor.timezone, weekday: "long" }).format(agora);
  const nome = actor.name.trim().split(/\s+/)[0] ?? actor.name;
  const por = origem === "audio" ? " A mensagem veio de um áudio transcrito (pode ter erros)." : origem === "imagem" ? " A mensagem veio de uma foto lida por máquina (pode ter erros)." : "";
  return `[Contexto: hoje é ${dia}, ${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}, ${hh}:${mm}. Quem escreve: ${nome}.${por}]`;
}

async function carregarMemoria(actor: WaActor, agora: Date): Promise<MensagemModelo[]> {
  const [r] = await withFamilia(actor.familyId, (tx) => tx.select().from(s.agentSessions).where(eq(s.agentSessions.memberId, actor.memberId)));
  if (!r || agora.getTime() - r.updatedAt.getTime() > MEMORIA_TTL_MS) return [];
  return r.turns.slice(-TURNOS_MEMORIA * 2).map((t) => ({ role: t.role, content: t.text }));
}

async function salvarMemoria(actor: WaActor, anteriores: MensagemModelo[], pergunta: string, resposta: string, agora: Date): Promise<void> {
  const base = anteriores.map((m) => ({ role: m.role, text: typeof m.content === "string" ? m.content : "" }));
  const turns = [...base, { role: "user" as const, text: pergunta.slice(0, MAX_TEXTO_TURNO) }, { role: "assistant" as const, text: resposta.slice(0, MAX_TEXTO_TURNO) }]
    .slice(-TURNOS_MEMORIA * 2);
  await withFamilia(actor.familyId, (tx) =>
    tx.insert(s.agentSessions).values({ familyId: actor.familyId, memberId: actor.memberId, turns, updatedAt: agora })
      .onConflictDoUpdate({ target: [s.agentSessions.familyId, s.agentSessions.memberId], set: { turns, updatedAt: agora } }));
}

/**
 * Responde uma pergunta livre. Erros de infraestrutura (banco fora do ar) lançam, para a fila tentar de novo; falha do MODELO vira
 * mensagem amigável sem detalhe. Registra uso e custo por família e respeita o limite mensal.
 */
export async function responderLivre(
  actor: WaActor, pergunta: string, msgId: string, deps: DepsAgente, origem: "texto" | "audio" | "imagem" = "texto",
): Promise<RespostaAgente> {
  const agora = (deps.agora ?? (() => new Date()))();
  if (!deps.modelo) return { texto: T.assistenteIndisponivel().texto, motivo: "indisponivel" };

  const uso = await resumoDeUso(actor.familyId, actor.timezone, agora);
  if (uso.excedeu) {
    await avisarLimiteEstourado(actor.familyId, uso, agora);
    logWa({ etapa: "agente", msgId, parada: "limite_mensal" });
    return { texto: T.assistentePausado().texto, motivo: "pausado" };
  }

  const memoria = await carregarMemoria(actor, agora);
  let mensagens: MensagemModelo[] = [...memoria, { role: "user", content: `${contexto(actor, agora, origem)}\n${pergunta}` }];
  const max = deps.maxIteracoes ?? MAX_ITERACOES;
  const modelo = modeloConfigurado();
  let tokens = 0;

  for (let iteracao = 1; ; iteracao++) {
    await deps.batimento?.();
    const t0 = Date.now();
    const r = await deps.modelo(montarPedido(mensagens, modelo));
    const corpo = r.body;
    const ok = r.status === 200 && !!corpo && Array.isArray(corpo.content);
    const u = ok ? (corpo!.usage ?? {}) : {};
    const t = {
      entrada: Number(u["input_tokens"] ?? 0), cacheEscrita: Number(u["cache_creation_input_tokens"] ?? 0),
      cacheLeitura: Number(u["cache_read_input_tokens"] ?? 0), saida: Number(u["output_tokens"] ?? 0),
    };
    if (ok) {
      tokens += t.entrada + t.cacheEscrita + t.cacheLeitura + t.saida;
      await registrarUso({ familyId: actor.familyId, memberId: actor.memberId, operacao: "conversa", provedor: "anthropic", modelo, msgId, tokens: t, idem: `uso:${msgId}:conversa:${iteracao}`, agora });
    }
    logWa({ etapa: "modelo", msgId, iteracao, status: r.status, ms: Date.now() - t0, ...t, parada: corpo?.stop_reason ?? "erro" });
    if (!ok) return { texto: T.assistenteErro().texto, motivo: "erro_modelo" };

    const conteudo = corpo!.content!;
    if (corpo!.stop_reason === "refusal") return { texto: T.assistenteRecusou().texto, motivo: "recusa" };
    if (corpo!.stop_reason === "max_tokens") return { texto: T.assistenteLonga().texto, motivo: "resposta_longa" };

    if (corpo!.stop_reason === "tool_use") {
      const chamadas = conteudo.filter((b) => b.type === "tool_use");
      if (chamadas.length === 0) return { texto: T.assistenteErro().texto, motivo: "erro_modelo" };
      if (iteracao >= max || tokens > MAX_TOKENS_MENSAGEM) return { texto: T.assistenteErro().texto, motivo: "limite_iteracoes" };
      const resultados: BlocoConteudo[] = [];
      for (const c of chamadas) {
        await deps.batimento?.();
        const t1 = Date.now();
        const res = await executarFerramenta(actor, String(c["name"] ?? ""), c["input"], agora);
        logWa({ etapa: "ferramenta", msgId, ferramenta: String(c["name"] ?? "").slice(0, 40), erro: res.erro, ms: Date.now() - t1 });
        resultados.push({ type: "tool_result", tool_use_id: String(c["id"] ?? ""), content: res.conteudo, ...(res.erro ? { is_error: true } : {}) });
      }
      mensagens = [...mensagens, { role: "assistant", content: conteudo }, { role: "user", content: resultados }];
      continue;
    }

    const texto = conteudo.filter((b) => b.type === "text").map((b) => String(b["text"] ?? "")).join("\n").trim();
    if (!texto) return { texto: T.assistenteErro().texto, motivo: "vazia" };
    await salvarMemoria(actor, memoria, pergunta, texto, agora);
    // se esta resposta levou o mês ao limite, avisa o administrador já (a próxima pergunta será a primeira recusada)
    const depois = await resumoDeUso(actor.familyId, actor.timezone, agora);
    if (depois.excedeu) await avisarLimiteEstourado(actor.familyId, depois, agora);
    return { texto, motivo: "ok" };
  }
}
