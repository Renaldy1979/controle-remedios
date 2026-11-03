import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** O batimento do worker (a cada ~30 s) mais velho que isto = o agendador de lembretes parou. */
const MINUTOS_ATE_WORKER_PARADO = 5;

/**
 * Verificação de saúde. Sem parâmetro (Docker/EasyPanel): só diz se o processo responde e se o banco conectou.
 * Com `?completo=1` (monitor externo, ex.: UptimeRobot): inclui também o worker de lembretes (503 se parou), o estado do último backup
 * e a versão no ar (`APP_VERSION`). Nunca devolve dado de família, usuário, versão de dependência nem texto de erro.
 */
export async function GET(req: Request) {
  const completo = new URL(req.url).searchParams.get("completo") === "1";
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
  let worker: "ok" | "parado" | "sem_registro" | undefined;
  let backup: string | undefined;
  if (completo && database === "ok") {
    try {
      const { lerRuntime } = await import("@/server/wa/runtime");
      const { situacaoDoBackup } = await import("@/server/ops/backup-status");
      const w = await lerRuntime<{ em: string }>("worker");
      worker = !w ? "sem_registro" : Date.now() - Date.parse(w.em) > MINUTOS_ATE_WORKER_PARADO * 60_000 ? "parado" : "ok";
      backup = situacaoDoBackup(await lerRuntime("backup"));
    } catch {
      worker = "sem_registro";
    }
  }
  const ok = database !== "indisponivel" && worker !== "parado";
  const corpo = {
    status: ok ? "ok" : "falha",
    database,
    ...(completo ? { worker, backup, versao: (process.env["APP_VERSION"] ?? "").slice(0, 40) || "desconhecida" } : {}),
  };
  return NextResponse.json(corpo, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
