import type { TranscriptionPort } from "../ports";

/** Transcrição delegada ao workflow N8N `transcricao-audio` (provedor trocável sem mexer no código). */
export class N8nTranscriber implements TranscriptionPort {
  private readonly doFetch: typeof fetch;

  constructor(private readonly cfg: { url: string; secret: string; fetch?: typeof fetch }) {
    this.doFetch = cfg.fetch ?? fetch;
  }

  async transcribe(input: { audio: Uint8Array; mimeType: string; language: string }): Promise<{ text: string }> {
    const res = await this.doFetch(this.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-medcuidar-secret": this.cfg.secret },
      body: JSON.stringify({ audioBase64: Buffer.from(input.audio).toString("base64"), mimeType: input.mimeType, language: input.language }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!res.ok) throw new Error(`N8N transcrição: HTTP ${res.status}`);
    const json = (await res.json()) as { text?: string };
    if (!json.text?.trim()) throw new Error("N8N transcrição: vazia");
    return { text: json.text.trim() };
  }
}
