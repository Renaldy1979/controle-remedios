import { arquivoReceita } from "@/server/api/handlers";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  return arquivoReceita(req, (await params).fileId);
}
