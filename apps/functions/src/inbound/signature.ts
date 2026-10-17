import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-medcuidar-signature";

/** `sha256=<hex>` do HMAC-SHA256 do corpo bruto com o segredo compartilhado (N8N ↔ função). */
export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const given = Buffer.from(header.trim());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const SECRET_HEADER = "x-medcuidar-secret";

/**
 * Alternativa à assinatura HMAC para o N8N usar só uma credencial "Header Auth" (sem código):
 * o mesmo segredo compartilhado no cabeçalho `x-medcuidar-secret`, sempre sobre HTTPS.
 */
export function verifySharedSecret(header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header.trim());
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
