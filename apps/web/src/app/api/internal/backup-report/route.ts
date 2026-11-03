import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * O serviço de backup informa aqui o resultado de cada rodada (Authorization: Bearer BACKUP_REPORT_SECRET). Sem segredo configurado
 * a rota não existe (404). Corpo: { ok: boolean, at?: ISO, bytes?: number }. Nunca devolve dado de família.
 */
export async function POST(req: Request) {
  const { segredoDoRelatorioConfere, lerRelatorio, registrarRelatorioBackup } = await import("@/server/ops/backup-status");
  if (!(process.env["BACKUP_REPORT_SECRET"] ?? "").trim()) return NextResponse.json({ erro: "nao_encontrado" }, { status: 404 });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!segredoDoRelatorioConfere(token)) return NextResponse.json({ erro: "nao_autorizado" }, { status: 401 });
  const texto = await req.text();
  if (texto.length > 2000) return NextResponse.json({ erro: "corpo_grande" }, { status: 413 });
  let corpo: unknown;
  try { corpo = JSON.parse(texto); } catch { return NextResponse.json({ erro: "json_invalido" }, { status: 400 }); }
  const r = lerRelatorio(corpo);
  if (!r) return NextResponse.json({ erro: "formato_invalido" }, { status: 400 });
  await registrarRelatorioBackup(r);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
