import { can } from "@medcuidar/shared";
import { NextResponse } from "next/server";
import { dataSourceKind } from "@/server/env";
import { verifyFileSignature } from "@/server/files";

export const dynamic = "force-dynamic";

const deny = (status: number, body?: string) => new NextResponse(body ?? null, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Página de uma receita (foto ou PDF), entregue SÓ por aqui: sessão válida + permissão de ver receitas + assinatura de curta
 * duração presa a arquivo, variante, pessoa e família + a página pertencer à família e a receita não estar excluída.
 * O bucket do Appwrite é privado: não existe URL pública do arquivo.
 */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  if (dataSourceKind() !== "postgres") return deny(404);
  const { fileId } = await params;
  const q = new URL(req.url).searchParams;
  const { getContext } = await import("@/server/pg/access");
  const ctx = await getContext();
  if (!ctx) return deny(401);
  if (!can(ctx.member, "prescriptions.view")) return deny(403);
  const memberId = q.get("m") ?? "";
  if (memberId !== ctx.memberId) return deny(403);
  const variant = q.get("v") === "thumb" ? "thumb" : "full";
  if (!(await verifyFileSignature(fileId, q.get("v") ?? "", Number(q.get("exp")), memberId, ctx.familyId, q.get("sig") ?? ""))) return deny(403);

  try {
    const [{ authorizeFile }, { rxStorage }] = await Promise.all([import("@/server/pg/prescriptions"), import("@/server/pg/rx-storage")]);
    const file = await authorizeFile(ctx, fileId, variant);
    if (!file) return deny(404);
    if (variant === "thumb" && !file.mime.startsWith("image/")) return deny(404); // PDF não tem miniatura: a tela mostra o papel desenhado
    const got = await rxStorage().read(file.storageFileId, variant);
    if (!got) return deny(404);
    return new NextResponse(got.bytes, {
      headers: { "Content-Type": got.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" },
    });
  } catch (e) {
    const { UserError } = await import("@/server/pg/errors");
    if (e instanceof UserError) return deny(503, e.message); // armazenamento não configurado ou fora do ar: mensagem clara, não 500
    console.error("[rx-file] falhou", (e as Error).name);
    return deny(500);
  }
}
