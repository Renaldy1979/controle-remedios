import { NextResponse } from "next/server";
import { buildOpenApi } from "@/server/api/registry";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildOpenApi());
}
