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

/** Hash do código de convite por WhatsApp, PRESO ao número esperado (o mesmo código em outro número gera outro hash). */
export const hashConviteCodigo = (telefone: string, codigo: string): string =>
  sha256(`medcuidar:convite:${telefone}:${codigo}`);

/** Token do link de primeiro acesso (uso único, 24 h). Guarde só `hash`; envie `token` uma vez ao WhatsApp do usuário. */
export function gerarTokenPrimeiroAcesso(): { token: string; hash: string } {
  // só 0-9a-f: sem "_" nem "-", que o WhatsApp (e o simulador) leem como itálico/formatação e podem mutilar o link na tela
  const token = randomBytes(32).toString("hex");
  return { token, hash: sha256(token) };
}

/** Validade de convites e de links de primeiro acesso. */
export const VALIDADE_CONVITE_MS = 24 * 60 * 60 * 1000;
