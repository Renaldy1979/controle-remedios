import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { enfileirar } from "./inbound";
import { criarEvolutionGo, criarProvedor, provedorConfigurado, type ProvedorWhatsapp } from "./provider";
import { logWa } from "./log";

/** Mensagens mais antigas que isto (backlog depois de reconexão) são ignoradas, não respondidas. */
export const IDADE_MAXIMA_S = 2 * 3600;
export const LIMITE_CORPO = 25 * 1024 * 1024; // foto de até 5 MB em base64 cabe com folga

/** Compara o segredo do caminho com `WHATSAPP_WEBHOOK_SECRET` em tempo constante. Sem segredo configurado, nada confere. */
export function segredoConfere(recebido: string, esperado = (process.env["WHATSAPP_WEBHOOK_SECRET"] ?? "").trim()): boolean {
  if (esperado.length < 16) return false;
  const a = createHash("sha256").update(String(recebido ?? "")).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** Provedor usado só para LER o webhook: funciona mesmo sem as variáveis de envio da Evolution (o parse não precisa delas). */
function provedorDeLeitura(): ProvedorWhatsapp {
  const p = provedorConfigurado() === "evolution-go" ? null : criarProvedor();
  return p ?? criarEvolutionGo({ baseUrl: "", apiKey: "", instanceId: process.env["EVOLUTION_INSTANCE_ID"]?.trim() ?? "" });
}

export type ResultadoWebhook =
  | { status: 200; corpo: { ok: true; ignorado?: string; duplicada?: boolean } }
  | { status: 400 | 404 | 413; corpo: { erro: { codigo: string; mensagem: string } } };

/** Núcleo da rota do webhook (separado do Next para ser testado): valida, ignora o que não é conversa, deduplica e enfileira. */
export async function tratarWebhook(segredo: string, texto: string, provedor: ProvedorWhatsapp = provedorDeLeitura()): Promise<ResultadoWebhook> {
  if (!segredoConfere(segredo)) return { status: 404, corpo: { erro: { codigo: "nao_encontrado", mensagem: "Não encontrado" } } };
  if (texto.length > LIMITE_CORPO) return { status: 413, corpo: { erro: { codigo: "muito_grande", mensagem: "Corpo grande demais" } } };
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return { status: 400, corpo: { erro: { codigo: "json_invalido", mensagem: "JSON inválido" } } };
  }
  const r = provedor.parseWebhook(corpo);
  if ("ignorar" in r) {
    logWa({ etapa: "webhook", ignorado: r.ignorar });
    return { status: 200, corpo: { ok: true, ignorado: r.ignorar } };
  }
  if (r.mensagem.idadeSegundos !== null && r.mensagem.idadeSegundos > IDADE_MAXIMA_S) {
    logWa({ etapa: "webhook", ignorado: "antiga" });
    return { status: 200, corpo: { ok: true, ignorado: "antiga" } };
  }
  const { novo } = await enfileirar(r.mensagem);
  logWa({ etapa: "webhook", msgId: r.mensagem.msgId, tipo: r.mensagem.tipo, novo });
  return { status: 200, corpo: { ok: true, duplicada: !novo } };
}
