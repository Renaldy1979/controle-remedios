import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/server/session-token";

/**
 * Protege as rotas quando DATA_SOURCE=appwrite: sem sessão assinada válida vai para /login (páginas)
 * ou recebe 401 (API). A autorização fina (perfil, permissões) é refeita no servidor a cada ação.
 */
export async function middleware(req: NextRequest) {
  if (process.env["DATA_SOURCE"] !== "appwrite") return NextResponse.next();

  const secret = process.env["SESSION_SECRET"] ?? process.env["LOGIN_CODE_SECRET"];
  const claims = secret ? await verifySession(req.cookies.get(SESSION_COOKIE)?.value, `session:${secret}`) : null;
  const { pathname } = req.nextUrl;

  if (pathname === "/login") {
    return claims ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (claims) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // tudo, exceto estáticos do Next, ícones e o catálogo interno de componentes
  matcher: ["/((?!_next/|favicon.ico|design-system|api/test/).*)"],
};
