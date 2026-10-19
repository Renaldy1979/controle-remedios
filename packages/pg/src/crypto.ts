import { createHash, randomInt, randomBytes } from "node:crypto";

/** sha256 em hex. Usado para chaves de API e para o código de verificação do WhatsApp. */
export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Código de 6 dígitos (criptograficamente aleatório). */
export const gerarCodigoVerificacao = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Hash do código guardado em members.verification_code_hash. */
export const hashCodigoVerificacao = (codigo: string): string => sha256(`medcuidar:verificacao:${codigo}`);

/** Gera uma chave de API nova. O valor em claro só existe aqui: guarde `hash`, mostre `chave` uma vez. */
export function gerarApiKey(tipo: "familia" | "plataforma"): { chave: string; hash: string; prefixo: "cdf_" | "cpl_" } {
  const prefixo = tipo === "familia" ? "cdf_" : "cpl_";
  const chave = prefixo + randomBytes(32).toString("base64url");
  return { chave, hash: sha256(chave), prefixo };
}
