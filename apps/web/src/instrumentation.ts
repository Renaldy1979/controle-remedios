/**
 * Inicia o WhatsApp direto no portal (worker da fila + agendador) uma vez por processo do servidor Next. Só no runtime Node (não no
 * edge, não no build) e só com WHATSAPP_WORKER_ENABLED=1. O import fica DENTRO do `if` do runtime: é o formato que o Next usa para
 * tirar o código Node do bundle edge.
 */
export async function register() {
  // ajuste único do Lote 5E (não depende do WhatsApp). Não bloqueia a subida; se falhar, tenta no próximo início.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATA_SOURCE === "postgres" && process.env.E2E_TEST_MODE !== "1") {
    const { unblockAccountsOnce } = await import("./server/ops/unblock-accounts");
    void unblockAccountsOnce().catch((e) => console.error("[contas] ajuste não concluído", (e as Error).name));
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WHATSAPP_WORKER_ENABLED === "1") {
    const { iniciarWhatsapp } = await import("./server/wa/boot");
    iniciarWhatsapp();
  }
}
