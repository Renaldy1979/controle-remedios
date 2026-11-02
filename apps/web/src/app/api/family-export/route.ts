import { NextResponse } from "next/server";
import { ForbiddenError } from "@/server/pg/errors";

export const dynamic = "force-dynamic";

/** Exportação dos dados da família (LGPD, só o Administrador). Baixa um arquivo JSON; a sessão vem do cookie, a família nunca vem da URL. */
export async function GET() {
  const { getContext } = await import("@/server/pg/access");
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { exportFamilyData } = await import("@/server/pg/privacy");
    const dados = await exportFamilyData(ctx);
    const dia = new Date().toLocaleDateString("sv-SE", { timeZone: ctx.timezone });
    return new NextResponse(JSON.stringify(dados, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="medcuidar-dados-${dia}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    console.error("[exportar] falhou", (e as Error).name);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
