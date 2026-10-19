import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regressão do staging (esqueci-senha): página que lê variável de ambiente em tempo de execução
 * (DATA_SOURCE etc.) e não é `force-dynamic` é gerada no `next build`, quando o Docker ainda não tem as
 * variáveis, e o resultado fica congelado (por exemplo, um redirect para o login).
 */
const root = join(__dirname);

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return pages(p);
    return /^(page|route|layout)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("páginas que dependem do ambiente", () => {
  const files = pages(root).map((f) => ({ f, src: readFileSync(f, "utf8") }));
  const dependents = files.filter(({ src }) => /dataSourceKind\(|process\.env\[/.test(src));

  it("existem páginas que leem o ambiente (o teste está olhando para os arquivos certos)", () => {
    expect(dependents.length).toBeGreaterThan(3);
  });

  for (const { f, src } of dependents) {
    // layouts herdam: basta o layout raiz do grupo ser dinâmico; páginas e rotas precisam declarar
    if (/layout\.tsx?$/.test(f) && /force-dynamic/.test(src)) continue;
    const name = f.slice(root.length + 1).replace(/\\/g, "/");
    it(`${name} declara force-dynamic`, () => {
      expect(src, `${name} lê o ambiente mas não tem export const dynamic = "force-dynamic"`).toMatch(
        /export const dynamic\s*=\s*["']force-dynamic["']/,
      );
    });
  }
});
