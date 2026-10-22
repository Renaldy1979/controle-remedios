/**
 * Log estruturado do WhatsApp. LGPD: só ids, etapa, duração, tokens e erro curto. NUNCA conteúdo de mensagem, telefone nem dado de saúde
 * (campos com esses nomes são descartados aqui, mesmo que alguém os passe por engano).
 */
const PROIBIDOS = new Set(["texto", "text", "telefone", "phone", "numero", "body", "payload", "base64", "resposta", "nome", "name"]);

export function logWa(evento: Record<string, unknown>): void {
  if (process.env["WHATSAPP_LOG"] === "off") return;
  const limpo: Record<string, unknown> = { origem: "whatsapp" };
  for (const [k, v] of Object.entries(evento)) {
    if (PROIBIDOS.has(k)) continue;
    limpo[k] = typeof v === "string" ? v.replace(/\d{8,}/g, "…").slice(0, 160) : v;
  }
  console.warn(JSON.stringify(limpo));
}
