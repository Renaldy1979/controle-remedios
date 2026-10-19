import { NextResponse } from "next/server";
import { testInviteLink } from "@/server/auth/appwrite";
import { e2eTestMode } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * SÓ PARA TESTE E2E (E2E_TEST_MODE=1, nunca com APP_ENV=production): devolve o último link de convite por e-mail gerado
 * para o endereço informado (no modo de teste o e-mail não é enviado). Em qualquer outro modo responde 404.
 */
export async function GET(req: Request) {
  if (!e2eTestMode()) return new NextResponse(null, { status: 404 });
  const email = new URL(req.url).searchParams.get("email") ?? "";
  const link = testInviteLink(email);
  return link ? NextResponse.json({ link }) : new NextResponse(null, { status: 404 });
}
