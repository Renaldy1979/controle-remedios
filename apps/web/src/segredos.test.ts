// @vitest-environment node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lote 5B (docs/13): varredura dos arquivos rastreados pelo git atrás de chaves e segredos de verdade. Os valores de exemplo do
 * desenvolvimento (senhas "*_dev" do docker-compose e o segredo fixo do e2e) são permitidos de propósito.
 */
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const PADROES = [
  "sk-ant-[A-Za-z0-9_-]{20,}", // Anthropic
  "AIza[0-9A-Za-z_-]{30,}", // Google (Gemini)
  "standard_[0-9a-f]{40,}", // chave de API do Appwrite
  "-----BEGIN [A-Z ]*PRIVATE KEY",
  "gh[pousr]_[A-Za-z0-9]{30,}", // GitHub
  "xox[baprs]-[A-Za-z0-9-]{10,}", // Slack
  "AKIA[0-9A-Z]{16}", // AWS
];

function gitGrep(extra: string[]): string {
  try {
    return execFileSync("git", ["grep", "-n", "-I", "-E", ...extra, "--", ".", ":!pnpm-lock.yaml"], { cwd: raiz, encoding: "utf8" });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 1) return ""; // git grep: 1 = nenhuma ocorrência
    throw e;
  }
}

describe("varredura de segredos no repositório", () => {
  it("nenhuma chave de provedor (Anthropic, Google, Appwrite, GitHub, Slack, AWS) nem chave privada nos arquivos do git", () => {
    expect(gitGrep(PADROES.flatMap((p) => ["-e", p]))).toBe("");
  });

  it("nenhum arquivo .env real está no git (só o .env.example)", () => {
    const lista = execFileSync("git", ["ls-files"], { cwd: raiz, encoding: "utf8" }).split("\n");
    expect(lista.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
  });
});
