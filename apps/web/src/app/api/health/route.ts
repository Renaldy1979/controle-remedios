import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Verificação de saúde para o Docker/EasyPanel. Só diz se o processo responde e se o banco conectou;
 * nunca devolve dado de família, usuário, versão de dependência nem texto de erro.
 */
export async function GET() {
  let database: "ok" | "indisponivel" | "nao_configurado" = "nao_configurado";
  if (process.env["DATA_SOURCE"] === "postgres") {
    try {
      const [{ getDb }, { sql }] = await Promise.all([import("@medcuidar/pg"), import("drizzle-orm")]);
      await getDb().execute(sql`select 1`);
      database = "ok";
    } catch (e) {
      database = "indisponivel";
      // Só o CÓDIGO do erro (nunca a mensagem, o endereço ou a senha), para o log dizer a causa:
      // 28P01 senha errada, 28000 papel inexistente, 3D000 banco inexistente, 42501 sem permissão,
      // ENOTFOUND nome do serviço errado, ECONNREFUSED/ETIMEDOUT banco inacessível.
      const err = e as { code?: unknown; cause?: { code?: unknown } };
      const code = String(err.code ?? err.cause?.code ?? "desconhecido").slice(0, 40);
      console.error(`[health] banco indisponível (codigo=${code})`);
    }
  }
  const ok = database !== "indisponivel";
  return NextResponse.json({ status: ok ? "ok" : "falha", database }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
