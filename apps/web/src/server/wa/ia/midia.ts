import "server-only";

/**
 * Áudio → transcrição e foto → leitura, pelo Google Gemini (API REST; chave só do ambiente, `GEMINI_API_KEY`). O Claude NUNCA recebe a
 * mídia: só o texto. A mídia (base64) existe só em memória durante a chamada. Falha, resposta vazia ou erro HTTP = `texto: null`
 * (a conversa pede texto). O uso vem do `usageMetadata`; sem ele, ESTIMA (áudio: 32 tokens/s; foto: ~1032 + prompt; saída ≈ 1 token a cada 3,5 caracteres).
 */
export const GEMINI_MODELO_PADRAO = "gemini-2.5-flash";
export const geminiModelo = (): string => ((process.env["GEMINI_MODEL"] ?? "").trim() || GEMINI_MODELO_PADRAO).replace(/^models\//, "");

export interface UsoMidia { entrada: number; saida: number; midia: number; estimado: boolean }
export interface ResultadoMidia { texto: string | null; uso: UsoMidia | null }
export interface LeitorMidia {
  transcreverAudio(base64: string, mime: string, segundos: number): Promise<ResultadoMidia>;
  lerImagem(base64: string, mime: string): Promise<ResultadoMidia>;
}

const PROMPT_AUDIO = "Transcreva fielmente, em português do Brasil, o que é dito neste áudio. Responda só com a transcrição, sem comentários.";
const PROMPT_IMAGEM = "Esta imagem foi enviada num chat sobre os remédios de uma pessoa idosa (pode ser caixa de remédio, receita, bula ou anotação). Descreva em português, de forma objetiva, o que está escrito e o que se vê: nomes de remédios, doses, datas, médico. Não interprete, não dê conselho e não invente o que estiver ilegível; diga 'ilegível'. Responda só com o texto, sem comentários.";

export function criarLeitorGemini(cfg: { apiKey: string; fetchFn?: typeof fetch; modelo?: string }): LeitorMidia {
  const f = cfg.fetchFn ?? fetch;
  const modelo = (cfg.modelo ?? geminiModelo()).replace(/^models\//, "");

  async function gerar(prompt: string, base64: string, mime: string) {
    const r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(60_000),
      headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }] }),
    });
    if (r.status !== 200) return null;
    const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: Record<string, number> };
    const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(" ");
    return { texto, uso: j.usageMetadata ?? null };
  }
  const saidaDe = (texto: string, m: Record<string, number> | null) => (m ? (Number(m["candidatesTokenCount"]) || 0) + (Number(m["thoughtsTokenCount"]) || 0) : Math.ceil(texto.length / 3.5));

  return {
    async transcreverAudio(base64, mime, segundos): Promise<ResultadoMidia> {
      try {
        const g = await gerar(PROMPT_AUDIO, base64, mime);
        if (!g) return { texto: null, uso: null };
        const seg = Math.min(Math.max(segundos || 0, 0), 180);
        const texto = g.texto.replace(/\s+/g, " ").trim().slice(0, 2000);
        return { texto: texto || null, uso: { entrada: 0, midia: g.uso ? Number(g.uso["promptTokenCount"]) || 0 : Math.round(seg * 32), saida: saidaDe(g.texto, g.uso), estimado: !g.uso } };
      } catch {
        return { texto: null, uso: null };
      }
    },
    async lerImagem(base64, mime): Promise<ResultadoMidia> {
      try {
        const g = await gerar(PROMPT_IMAGEM, base64, mime);
        if (!g) return { texto: null, uso: null };
        const texto = g.texto.trim().slice(0, 3000);
        return { texto: texto || null, uso: { entrada: g.uso ? Number(g.uso["promptTokenCount"]) || 0 : 1032 + Math.ceil(PROMPT_IMAGEM.length / 3.5), midia: 0, saida: saidaDe(g.texto, g.uso), estimado: !g.uso } };
      } catch {
        return { texto: null, uso: null };
      }
    },
  };
}

/** Leitor do ambiente; null sem `GEMINI_API_KEY` (áudio e foto respondem que não deu para entender). */
export function leitorDoAmbiente(): LeitorMidia | null {
  const k = (process.env["GEMINI_API_KEY"] ?? "").trim();
  return k ? criarLeitorGemini({ apiKey: k }) : null;
}
