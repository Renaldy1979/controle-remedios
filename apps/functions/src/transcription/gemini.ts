import type { TranscriptionPort } from "../ports";

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
}

/** Transcrição de áudio via Gemini (REST, áudio inline em base64). O texto devolvido vai para auditoria. */
export class GeminiTranscriber implements TranscriptionPort {
  private readonly doFetch: typeof fetch;

  constructor(private readonly cfg: GeminiConfig) {
    this.doFetch = cfg.fetch ?? fetch;
  }

  async transcribe(input: { audio: Uint8Array; mimeType: string; language: string }): Promise<{ text: string }> {
    const model = this.cfg.model ?? "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await this.doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.cfg.apiKey },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `Transcreva fielmente este áudio em ${input.language}. Responda só com a transcrição, sem comentários.` },
              { inlineData: { mimeType: input.mimeType.split(";")[0], data: Buffer.from(input.audio).toString("base64") } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    // Nunca incluir o corpo da resposta no erro: pode conter a transcrição.
    if (!res.ok) throw new Error(`Gemini: HTTP ${res.status}`);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    if (!text) throw new Error("Gemini: transcrição vazia");
    return { text };
  }
}
