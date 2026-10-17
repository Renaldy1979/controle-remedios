import { NextResponse } from "next/server";
import { Query } from "node-appwrite";
import { clients, familyDb } from "@/server/clients";
import { listAll, str } from "@/server/data";
import { PRESCRIPTION_BUCKET, e2eTestMode } from "@/server/env";

export const dynamic = "force-dynamic";

const DEMO_FAMILY = "demo-familia-souza";

/**
 * SÓ PARA TESTE E2E: apaga de vez as receitas EXCLUÍDAS da família demo (as de teste), com itens, arquivos e
 * imagens no Storage. Nunca toca em outra família nem nas receitas do seed (ids `demo-rx-*`).
 */
export async function POST() {
  if (!e2eTestMode()) return new NextResponse(null, { status: 404 });
  const db = familyDb(DEMO_FAMILY);
  const { storage } = clients();
  let removed = 0;
  for (const rx of await listAll(db, "prescriptions", [Query.isNotNull("deleted_at")])) {
    if (rx.$id.startsWith("demo-rx-")) continue;
    for (const col of ["prescription_items", "prescription_files", "prescription_views", "prescription_shares"]) {
      for (const row of await listAll(db, col, [Query.equal("prescription_id", rx.$id)])) {
        if (col === "prescription_files") await storage.deleteFile(PRESCRIPTION_BUCKET, str(row, "storage_file_id")).catch(() => undefined);
        await db.remove(col, row.$id);
      }
    }
    await db.remove("prescriptions", rx.$id);
    removed++;
  }
  return NextResponse.json({ removed });
}
