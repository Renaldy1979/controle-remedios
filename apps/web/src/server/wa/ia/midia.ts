import "server-only";
import { logWa } from "../log";

/**
 * Áudio → transcrição e foto → leitura, pelo Google Gemini (API REST; chave só do ambiente, `GEMINI_API_KEY`). O Claude NUNCA recebe a
 * mídia: só o texto. A mídia (base64) existe só em memória durante a chamada. Falha, resposta vazia ou erro HTTP = `texto: null` COM
 * `motivo` resumido (sem segredo nem conteúdo), que vai para o log e para o painel de Configurações › WhatsApp.
 * O uso vem do `usageMetadata`; sem ele, ESTIMA (áudio: 32 tokens/s; foto: ~1032 + prompt; saída ≈ 1 token a cada 3,5 caracteres).
 *
 * Modelo: `GEMINI_MODEL` (padrão `gemini-3.5-flash-lite`, o usado em produção no projeto financeiro). O `gemini-2.5-flash` foi aposentado
 * pelo Google (desligamento anunciado em 16/10/2026) e responde 404: em 404 tenta UMA vez `gemini-3.5-flash` antes de desistir.
 * Formato: `generateContent` com `inline_data { mime_type, data }` (REST aceita snake_case); limite de 20 MB por pedido (com tudo).
 */
export const GEMINI_MODELO_PADRAO = "gemini-3.5-flash-lite";
export const GEMINI_MODELO_RESERVA = "gemini-3.5-flash";
export const geminiModelo = (): string => ((process.env["GEMINI_MODEL"] ?? "").trim() || GEMINI_MODELO_PADRAO).replace(/^models\//, "");

/** Tipos de áudio que a Gemini aceita inline (ai.google.dev/gemini-api/docs/audio). */
export const MIMES_AUDIO_GEMINI = [
  "audio/wav", "audio/mp3", "audio/mpeg", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac", "audio/m4a", "audio/opus", "audio/webm",
] as const;
const APELIDOS_AUDIO: Record<string, string> = { "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-aiff": "audio/aiff", "audio/mp4": "audio/m4a", "audio/x-m4a": "audio/m4a", "audio/x-flac": "audio/flac", "audio/vnd.wave": "audio/wav" };

/** `audio/ogg; codecs=opus` → `audio/ogg` (tipo base, minúsculo, sem parâmetros). */
export const mimeBase = (m: string): string => String(m ?? "").split(";")[0]!.trim().toLowerCase();

/** Mime de áudio aceito pela Gemini, ou null se não for um dos suportados. */
export function mimeAudioGemini(m: string): string | null {
  const b = mimeBase(m);
  const c = APELIDOS_AUDIO[b] ?? b;
  return (MIMES_AUDIO_GEMINI as readonly string[]).includes(c) ? c : null;
}

export interface UsoMidia { entrada: number; saida: number; midia: number; estimado: boolean }
export interface ResultadoMidia {
  texto: string | null;
  uso: UsoMidia | null;
  /** quando `texto` é null: causa resumida, sem segredo e sem conteúdo (ex.: "Gemini recusou a chave (403)") */
  motivo?: string;
}
export interface LeitorMidia {
  transcreverAudio(base64: string, mime: string, segundos: number): Promise<ResultadoMidia>;
  lerImagem(base64: string, mime: string): Promise<ResultadoMidia>;
}

const PROMPT_AUDIO = "Transcreva fielmente, em português do Brasil, o que é dito neste áudio. Responda só com a transcrição, sem comentários.";
const PROMPT_IMAGEM = "Esta imagem foi enviada num chat sobre os remédios de uma pessoa idosa (pode ser caixa de remédio, receita, bula ou anotação). Descreva em português, de forma objetiva, o que está escrito e o que se vê: nomes de remédios, doses, datas, médico. Não interprete, não dê conselho e não invente o que estiver ilegível; diga 'ilegível'. Responda só com o texto, sem comentários.";

type Resp =
  | { ok: true; texto: string; uso: Record<string, number> | null; bloqueio: string }
  | { ok: false; status: number; codigo: string };

/** Causa resumida de uma resposta de erro da Gemini (status HTTP + `error.status`), sem segredo. */
export function motivoDeErro(status: number, codigo: string, modelo: string, tipo: "audio" | "imagem"): string {
  const c = codigo ? ` ${codigo}` : "";
  if (status === 0) return `não consegui falar com a Gemini (rede ou tempo esgotado)`;
  if (status === 401 || status === 403) return `Gemini recusou a chave (${status}${c}): confira GEMINI_API_KEY`;
  if (status === 404) return `modelo da Gemini não encontrado (404): troque GEMINI_MODEL (testado: ${modelo})`;
  if (status === 400) return `Gemini não aceitou ${tipo === "audio" ? "o áudio (formato ou tamanho)" : "a imagem"} (400${c})`;
  if (status === 429) return `limite de uso da Gemini atingido (429)`;
  if (status >= 500) return `Gemini indisponível (${status})`;
  return `Gemini respondeu ${status}${c}`;
}

export function criarLeitorGemini(cfg: { apiKey: string; fetchFn?: typeof fetch; modelo?: string; modeloReserva?: string }): LeitorMidia {
  const f = cfg.fetchFn ?? fetch;
  const principal = (cfg.modelo ?? geminiModelo()).replace(/^models\//, "");
  const reserva = (cfg.modeloReserva ?? GEMINI_MODELO_RESERVA).replace(/^models\//, "");

  async function chamar(modelo: string, prompt: string, base64: string, mime: string): Promise<Resp> {
    let r: Response;
    try {
      r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(60_000),
        headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }] }] }),
      });
    } catch {
      return { ok: false, status: 0, codigo: "" };
    }
    const j = (await r.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; usageMetadata?: Record<string, number>;
      promptFeedback?: { blockReason?: string }; error?: { status?: string };
    } | null;
    if (r.status !== 200) return { ok: false, status: r.status, codigo: String(j?.error?.status ?? "").slice(0, 40) };
    const texto = (j?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(" ");
    return { ok: true, texto, uso: j?.usageMetadata ?? null, bloqueio: j?.promptFeedback?.blockReason ?? j?.candidates?.[0]?.finishReason ?? "" };
  }

  /** Chama a Gemini (com a reserva em 404) e registra o diagnóstico SEM segredo nem conteúdo. */
  async function gerar(tipo: "audio" | "imagem", prompt: string, base64: string, mime: string) {
    const kb = Math.round((base64.length * 3) / 4 / 1024);
    let modelo = principal;
    let r = await chamar(modelo, prompt, base64, mime);
    logWa({ etapa: "gemini", tipo, modelo, mime, kb, status: r.ok ? 200 : r.status, codigo: r.ok ? "" : r.codigo });
    if (!r.ok && r.status === 404 && reserva !== principal) {
      modelo = reserva;
      r = await chamar(modelo, prompt, base64, mime);
      logWa({ etapa: "gemini", tipo, modelo, mime, kb, status: r.ok ? 200 : r.status, codigo: r.ok ? "" : r.codigo, reserva: true });
    }
    return { r, modelo };
  }

  const saidaDe = (texto: string, m: Record<string, number> | null) => (m ? (Number(m["candidatesTokenCount"]) || 0) + (Number(m["thoughtsTokenCount"]) || 0) : Math.ceil(texto.length / 3.5));

  return {
    async transcreverAudio(base64, mime, segundos): Promise<ResultadoMidia> {
      const mimeOk = mimeAudioGemini(mime);
      if (!mimeOk) return { texto: null, uso: null, motivo: `áudio em formato que a Gemini não aceita (${mimeBase(mime) || "sem tipo"})` };
      try {
        const { r, modelo } = await gerar("audio", PROMPT_AUDIO, base64, mimeOk);
        if (!r.ok) return { texto: null, uso: null, motivo: motivoDeErro(r.status, r.codigo, modelo, "audio") };
        const seg = Math.min(Math.max(segundos || 0, 0), 180);
        const texto = r.texto.replace(/\s+/g, " ").trim().slice(0, 2000);
        const uso = { entrada: 0, midia: r.uso ? Number(r.uso["promptTokenCount"]) || 0 : Math.round(seg * 32), saida: saidaDe(r.texto, r.uso), estimado: !r.uso };
        return texto ? { texto, uso } : { texto: null, uso, motivo: `Gemini devolveu a transcrição vazia${r.bloqueio ? ` (${r.bloqueio})` : ""}: áudio sem fala ou ruído` };
      } catch {
        return { texto: null, uso: null, motivo: "erro inesperado ao transcrever o áudio" };
      }
    },
    async lerImagem(base64, mime): Promise<ResultadoMidia> {
      try {
        const { r, modelo } = await gerar("imagem", PROMPT_IMAGEM, base64, mimeBase(mime) || "image/jpeg");
        if (!r.ok) return { texto: null, uso: null, motivo: motivoDeErro(r.status, r.codigo, modelo, "imagem") };
        const texto = r.texto.trim().slice(0, 3000);
        const uso = { entrada: r.uso ? Number(r.uso["promptTokenCount"]) || 0 : 1032 + Math.ceil(PROMPT_IMAGEM.length / 3.5), midia: 0, saida: saidaDe(r.texto, r.uso), estimado: !r.uso };
        return texto ? { texto, uso } : { texto: null, uso, motivo: `Gemini devolveu a leitura vazia${r.bloqueio ? ` (${r.bloqueio})` : ""}` };
      } catch {
        return { texto: null, uso: null, motivo: "erro inesperado ao ler a imagem" };
      }
    },
  };
}

/** Leitor do ambiente; null sem `GEMINI_API_KEY` (áudio e foto respondem que não deu para entender). */
export function leitorDoAmbiente(): LeitorMidia | null {
  const k = (process.env["GEMINI_API_KEY"] ?? "").trim();
  return k ? criarLeitorGemini({ apiKey: k }) : null;
}
