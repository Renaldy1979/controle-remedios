import "server-only";
import { fileUrlSecret } from "./env";
import { hmacHex } from "./hmac";

export type FileVariant = "thumb" | "full";
export const FILE_URL_TTL_SEC = 600;

const payload = (fileId: string, v: FileVariant, exp: number, memberId: string, familyId: string) => `${fileId}|${v}|${exp}|${memberId}|${familyId}`;

/**
 * URL assinada de curta duração (10 min) para uma página de receita. A assinatura prende arquivo, variante,
 * validade, pessoa e família; a rota ainda exige a sessão da mesma pessoa e a permissão de ver receitas.
 */
export async function signFileUrl(fileId: string, v: FileVariant, memberId: string, familyId: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const exp = nowSec + FILE_URL_TTL_SEC;
  const sig = await hmacHex(payload(fileId, v, exp, memberId, familyId), fileUrlSecret());
  return `/api/rx-file/${encodeURIComponent(fileId)}?v=${v}&exp=${exp}&m=${encodeURIComponent(memberId)}&sig=${sig}`;
}

export async function verifyFileSignature(fileId: string, v: string, exp: number, memberId: string, familyId: string, sig: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if ((v !== "thumb" && v !== "full") || !Number.isFinite(exp) || exp < nowSec) return false;
  const expected = await hmacHex(payload(fileId, v, exp, memberId, familyId), fileUrlSecret());
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
