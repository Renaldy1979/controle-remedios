import { NextResponse, type NextRequest } from "next/server";
import { tratarWebhook } from "@/server/wa/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/whatsapp/evolution/<segredo> — webhook do provedor (Evolution Go). Público (fora da sessão): a proteção é o SEGREDO NO
 * CAMINHO (WHATSAPP_WEBHOOK_SECRET), comparado em tempo constante; segredo errado = 404 sem detalhe. Faz o mínimo e responde 200 na hora:
 * ignora o que não é conversa, deduplica pelo id da mensagem e grava na fila (o worker conversa). Nada do corpo é logado.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ segredo: string }> }) {
  const { segredo } = await params;
  const r = await tratarWebhook(segredo ?? "", await req.text());
  return NextResponse.json(r.corpo, { status: r.status });
}
