import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/cookies";

/**
 * Com DATA_SOURCE=appwrite, quem não tem cookie de sessão vai para /login (páginas) ou recebe 401 (API).
 * Aqui só dá para olhar se o cookie existe (Edge); a sessão é validada NO APPWRITE em cada requisição por
 * getAccess() (layout, Server Actions e rotas) e uma sessão revogada cai no /login.
 */
export function middleware(req: NextRequest) {
  if (process.env["DATA_SOURCE"] !== "appwrite") return NextResponse.next();
  if (req.nextUrl.pathname === "/login" || req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // tudo, exceto estáticos do Next, ícones e o catálogo interno de componentes
  matcher: ["/((?!_next/|favicon.ico|design-system|api/test/).*)"],
};
