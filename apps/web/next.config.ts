import type { NextConfig } from "next";
import path from "node:path";

// As variáveis do servidor ficam no .env da raiz do monorepo (nunca no cliente). Não sobrescreve o que já está definido.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  /* sem .env na raiz (CI/produção): vale o ambiente do processo */
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lint e tipos rodam à parte (`pnpm lint` e `pnpm typecheck`, também na CI). NEXT_SKIP_TYPECHECK=1 só acelera o build do e2e local.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: process.env["NEXT_SKIP_TYPECHECK"] === "1" },
  // Imagem Docker enxuta (Dockerfile na raiz, que define NEXT_OUTPUT=standalone): copia só o que o servidor usa.
  // Fora do Docker fica desligado: no Windows o modo standalone exige permissão para criar links simbólicos.
  ...(process.env["NEXT_OUTPUT"] === "standalone" ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "../..") } : {}),
  transpilePackages: ["@medcuidar/shared", "@medcuidar/pg", "@medcuidar/db", "@medcuidar/domain", "@medcuidar/functions", "@medcuidar/channels"],
  serverExternalPackages: ["node-appwrite"],
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
};

export default nextConfig;
