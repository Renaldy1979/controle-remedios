import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Limite de tentativas de login, além do que o Appwrite já faz: erros demais para o mesmo e-mail ou do mesmo endereço
 * travam novas tentativas por um tempo. Fica na memória do servidor (um só processo na VPS); reiniciar o portal zera os contadores.
 * A chave é um hash: o e-mail não fica guardado em texto nem aparece em log.
 */
const JANELA_MS = 15 * 60_000;
const MAX_POR_EMAIL = 8;
const MAX_POR_IP = 40;
const MAX_CHAVES = 20_000;

interface Entrada { falhas: number; desde: number }
const falhas = new Map<string, Entrada>();

const chave = (tipo: "e" | "i", valor: string) => `${tipo}:${createHash("sha256").update(valor).digest("hex").slice(0, 24)}`;

function atual(k: string, agora: number): Entrada | undefined {
  const e = falhas.get(k);
  if (!e) return undefined;
  if (agora - e.desde > JANELA_MS) {
    falhas.delete(k);
    return undefined;
  }
  return e;
}

/** Endereço de quem chamou (primeiro da cadeia do proxy do EasyPanel). Sem ele, só vale o limite por e-mail. */
export async function enderecoDoCliente(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "").slice(0, 64);
}

/** Minutos até poder tentar de novo; 0 = liberado. */
export function bloqueadoPor(email: string, ip: string, agora = Date.now()): number {
  const porEmail = atual(chave("e", email), agora);
  const porIp = ip ? atual(chave("i", ip), agora) : undefined;
  const estouro = (porEmail && porEmail.falhas >= MAX_POR_EMAIL ? porEmail : null) ?? (porIp && porIp.falhas >= MAX_POR_IP ? porIp : null);
  return estouro ? Math.max(1, Math.ceil((estouro.desde + JANELA_MS - agora) / 60_000)) : 0;
}

export function registrarFalha(email: string, ip: string, agora = Date.now()): void {
  if (falhas.size > MAX_CHAVES) {
    for (const [k, e] of falhas) if (agora - e.desde > JANELA_MS) falhas.delete(k);
    if (falhas.size > MAX_CHAVES) falhas.clear();
  }
  for (const k of [chave("e", email), ...(ip ? [chave("i", ip)] : [])]) {
    const e = atual(k, agora);
    falhas.set(k, e ? { ...e, falhas: e.falhas + 1 } : { falhas: 1, desde: agora });
  }
}

/** Login certo limpa só o contador do e-mail (o do endereço continua, para frear quem testa muitas contas). */
export function registrarSucesso(email: string): void {
  falhas.delete(chave("e", email));
}

/** Só para testes. */
export function zerarLimites(): void {
  falhas.clear();
}
