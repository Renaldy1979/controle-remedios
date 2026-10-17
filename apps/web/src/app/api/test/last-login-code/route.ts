import type { FakeChannel } from "@medcuidar/channels";
import { NextResponse } from "next/server";
import { Query } from "node-appwrite";
import { clients } from "@/server/clients";
import { e2eTestMode } from "@/server/env";
import { getChannel } from "@/server/services";

export const dynamic = "force-dynamic";

const onlyDigits = (s: string | null) => (s ?? "").replace(/\D/g, "");

/**
 * SÓ PARA TESTE E2E (E2E_TEST_MODE=1, nunca em produção): devolve o último código de login enviado
 * pelo canal falso para o telefone informado. Em qualquer outro modo responde 404.
 * `index` deixa o teste esperar por uma mensagem NOVA (e não ler o código de uma tentativa anterior).
 */
export async function GET(req: Request) {
  if (!e2eTestMode()) return new NextResponse(null, { status: 404 });
  // sem instanceof: Server Actions e rotas podem carregar cópias separadas do módulo
  const ch = getChannel() as Partial<FakeChannel>;
  if (!Array.isArray(ch.sent)) return new NextResponse(null, { status: 404 });
  const digits = onlyDigits(new URL(req.url).searchParams.get("phone"));
  let index = -1;
  for (let i = ch.sent.length - 1; i >= 0; i--) {
    if (onlyDigits(ch.sent[i]!.to).endsWith(digits.slice(-9))) {
      index = i;
      break;
    }
  }
  const code = index >= 0 ? ch.sent[index]!.text.match(/\b(\d{6})\b/)?.[1] : undefined;
  return code ? NextResponse.json({ code, index }) : NextResponse.json({ code: null, index }, { status: 404 });
}

/**
 * SÓ PARA TESTE E2E: apaga os códigos de login pendentes do telefone (limpa o limite de 1 envio por minuto
 * e 5 por hora, que são regras reais e continuam valendo fora do modo de teste).
 */
export async function DELETE(req: Request) {
  if (!e2eTestMode()) return new NextResponse(null, { status: 404 });
  const digits = onlyDigits(new URL(req.url).searchParams.get("phone"));
  if (digits.length < 10) return new NextResponse(null, { status: 400 });
  const { databases, databaseId } = clients();
  const rows = await databases.listDocuments(databaseId, "login_codes", [Query.equal("phone_e164", `+55${digits}`), Query.limit(100)]);
  for (const r of rows.documents) await databases.deleteDocument(databaseId, "login_codes", r.$id);
  return NextResponse.json({ removed: rows.total });
}
