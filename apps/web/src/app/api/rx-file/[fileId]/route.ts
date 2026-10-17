import { can } from "@medcuidar/shared";
import { NextResponse } from "next/server";
import { clients } from "@/server/clients";
import { getContext } from "@/server/context";
import { audit, str, type R } from "@/server/data";
import { PRESCRIPTION_BUCKET } from "@/server/env";
import { verifyFileSignature } from "@/server/files";

export const dynamic = "force-dynamic";

const deny = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

/** Imagem de uma página de receita: sessão + permissão + assinatura de curta duração. Nunca público. */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const q = new URL(req.url).searchParams;
  const ctx = await getContext();
  if (!ctx) return deny(401);
  if (!can(ctx.member, "prescriptions.view")) return deny(403);
  const memberId = q.get("m") ?? "";
  if (memberId !== ctx.member.id) return deny(403);
  if (!(await verifyFileSignature(fileId, q.get("v") ?? "", Number(q.get("exp")), memberId, ctx.familyId, q.get("sig") ?? ""))) return deny(403);

  try {
    // o registro do arquivo precisa ser da família (FamilyScopedDb) e a receita não pode estar excluída
    const file = (await ctx.db.get("prescription_files", fileId)) as unknown as R;
    const rx = (await ctx.db.get("prescriptions", str(file, "prescription_id"))) as unknown as R;
    if (rx["deleted_at"]) return deny(404);
    const mime = str(file, "mime");
    const storageId = str(file, "storage_file_id");
    const { storage } = clients();
    let bytes: ArrayBuffer;
    let contentType = mime;
    if (q.get("v") === "thumb") {
      if (!mime.startsWith("image/")) return deny(404); // PDF não tem miniatura: a tela mostra o papel desenhado
      bytes = await storage.getFilePreview({ bucketId: PRESCRIPTION_BUCKET, fileId: storageId, width: 360, quality: 60 });
      contentType = "image/jpeg";
    } else {
      bytes = await storage.getFileView({ bucketId: PRESCRIPTION_BUCKET, fileId: storageId });
      await audit(ctx.db, ctx.member.id, "rx.file_opened", "prescription_file", fileId, {});
    }
    return new NextResponse(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch {
    return deny(404);
  }
}
