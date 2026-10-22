import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Chamada ao modelo (Messages API da Anthropic). Tudo que o agente sabe do modelo está aqui: o resto do código só enxerga
 * `ChamarModelo`, que os testes substituem por respostas roteirizadas (nenhuma chamada real nos testes automáticos).
 * A chave só vem do ambiente (`ANTHROPIC_API_KEY`); o modelo é `ANTHROPIC_MODEL` (padrão claude-sonnet-5-5).
 */
export const MODELO_PADRAO = "claude-sonnet-5-5";
export const modeloConfigurado = (): string => (process.env["ANTHROPIC_MODEL"] ?? "").trim() || MODELO_PADRAO;
export const MAX_TOKENS_RESPOSTA = 1024;

export type BlocoConteudo = { type: string; [k: string]: unknown };
export type MensagemModelo = { role: "user" | "assistant"; content: string | BlocoConteudo[] };

/** Corpo enviado à Messages API (o que os testes inspecionam: ferramentas, system, mensagens). */
export interface PedidoModelo {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
  tools: ReadonlyArray<unknown>;
  messages: MensagemModelo[];
  output_config: { effort: "low" | "medium" | "high" };
}

export interface RespostaModelo {
  /** 200 = ok; qualquer outro = falha (0 = sem resposta). Nunca lança por falha do modelo. */
  status: number;
  body: { content?: BlocoConteudo[]; stop_reason?: string | null; usage?: Record<string, number | null | undefined> } | null;
}

export type ChamarModelo = (pedido: PedidoModelo) => Promise<RespostaModelo>;

/** Cliente real. Tenta de novo (SDK: 429/5xx/rede, 2 vezes) e devolve só `{status, body}`; nunca loga corpo, texto nem chave. */
export function criarModeloAnthropic(apiKey: string): ChamarModelo {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  return async (pedido) => {
    try {
      const msg = await client.messages.create(pedido as unknown as Anthropic.MessageCreateParamsNonStreaming);
      return { status: 200, body: msg as unknown as RespostaModelo["body"] };
    } catch (e) {
      return { status: e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status : 0, body: null };
    }
  };
}

/** Modelo do ambiente, ou null sem `ANTHROPIC_API_KEY` (o texto livre responde que o assistente está indisponível). */
export function modeloDoAmbiente(): ChamarModelo | null {
  const k = (process.env["ANTHROPIC_API_KEY"] ?? "").trim();
  return k ? criarModeloAnthropic(k) : null;
}
