import type { NextConfig } from "next";
import path from "node:path";

// As variáveis do servidor ficam no .env da raiz do monorepo (nunca no cliente). Não sobrescreve o que já está definido.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  /* sem .env na raiz (CI/produção): vale o ambiente do processo */
}

const isDev = process.env["NODE_ENV"] !== "production";

/**
 * Cabeçalhos de segurança em todas as respostas (docs/13). A CSP precisa de 'unsafe-inline' em script/estilo porque o Next injeta
 * scripts de hidratação e o tema inicial é inline; o resto fica restrito à própria origem. Receitas em PDF abrem num iframe da própria origem.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
      "frame-src 'self'",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Lint e tipos rodam à parte (`pnpm lint` e `pnpm typecheck`, também na CI). NEXT_SKIP_TYPECHECK=1 só acelera o build do e2e local.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: process.env["NEXT_SKIP_TYPECHECK"] === "1" },
  // Imagem Docker enxuta (Dockerfile na raiz, que define NEXT_OUTPUT=standalone): copia só o que o servidor usa.
  // Fora do Docker fica desligado: no Windows o modo standalone exige permissão para criar links simbólicos.
  ...(process.env["NEXT_OUTPUT"] === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  transpilePackages: ["@medcuidar/shared", "@medcuidar/pg", "@medcuidar/domain"],
  serverExternalPackages: ["node-appwrite"],
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
};

export default nextConfig;
