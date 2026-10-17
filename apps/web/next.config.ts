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
  transpilePackages: ["@medcuidar/shared", "@medcuidar/db", "@medcuidar/domain", "@medcuidar/functions", "@medcuidar/channels"],
  serverExternalPackages: ["node-appwrite"],
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
};

export default nextConfig;
