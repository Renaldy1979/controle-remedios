/**
 * Preços de IA em USD por MILHÃO de tokens. Como 1 USD = 1.000.000 micro-dólares, `tokens × preço` já dá o custo em micro-dólares.
 * Valores de tabela (Anthropic: docs da API; Google: tabela pública do Gemini Flash). Modelo fora da tabela → custo 0 marcado
 * como ESTIMADO (o uso não se perde; ajuste a tabela e confira). Se os preços mudarem, edite aqui.
 */
export interface Preco {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  /** tokens de mídia (áudio) cobrados à parte; sem valor usa o de entrada */
  midia?: number;
}

export const PRECOS: Record<string, Preco> = {
  "claude-sonnet-5-5": { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  "claude-sonnet-5": { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  "claude-opus-5-5": { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
  // Google (ai.google.dev/gemini-api/docs/pricing, conferido em 2026-10-05 no projeto financeiro: packages/db/drizzle/0007_custos_ia.sql):
  // texto/imagem 0,30; áudio 2,50; saída (com thinking) 2,50. O 2.5-flash foi aposentado (404) e saiu da tabela.
  "gemini-3.5-flash-lite": { entrada: 0.3, saida: 2.5, cacheLeitura: 0, cacheEscrita: 0, midia: 2.5 },
  // "gemini-3.5-flash" (reserva em 404) não tem preço conferido: custo 0 marcado como estimado
};

export interface TokensUso {
  entrada: number;
  saida: number;
  cacheLeitura?: number;
  cacheEscrita?: number;
  midia?: number;
}

/** Custo em micro-dólares (inteiro) e se o preço era desconhecido (estimado). */
export function custoMicros(modelo: string, t: TokensUso): { micros: number; estimado: boolean } {
  const p = PRECOS[modelo.replace(/^models\//, "")];
  if (!p) return { micros: 0, estimado: true };
  const total = t.entrada * p.entrada + t.saida * p.saida + (t.cacheLeitura ?? 0) * p.cacheLeitura + (t.cacheEscrita ?? 0) * p.cacheEscrita
    + (t.midia ?? 0) * (p.midia ?? p.entrada);
  return { micros: Math.round(total), estimado: false };
}

export const usdDeMicros = (m: number): number => m / 1_000_000;
export const microsDeUsd = (usd: number): number => Math.round(usd * 1_000_000);
export const formatarUsd = (micros: number): string => `US$ ${usdDeMicros(micros).toFixed(2).replace(".", ",")}`;
