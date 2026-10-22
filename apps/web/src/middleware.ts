import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/server/cookies";

/** Telas e rotas que não exigem sessão. Tudo o mais, com DATA_SOURCE=postgres, pede o cookie da sessão. */
const PUBLIC = ["/login", "/criar-conta", "/verificar-email", "/esqueci-senha", "/redefinir-senha", "/aceitar-convite", "/primeiro-acesso", "/api/health", "/api/v1", "/api/whatsapp/evolution"];
const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Com DATA_SOURCE=postgres, quem não tem cookie de sessão vai para /login (páginas) ou recebe 401 (API).
 * Aqui só dá para olhar se o cookie existe (Edge); a sessão é validada NO APPWRITE em cada requisição
 * (layout e Server Actions), e uma sessão revogada cai no /login.
 */
export function middleware(req: NextRequest) {
  if (process.env["DATA_SOURCE"] !== "postgres") return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (isPublic(pathname) || req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // tudo, exceto estáticos do Next, ícones, o catálogo interno de componentes e as rotas de teste (que se recusam sozinhas)
  matcher: ["/((?!_next/|favicon.ico|design-system|api/test/).*)"],
};
