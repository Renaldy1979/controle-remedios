// @vitest-environment node
/**
 * Contrato da API: o OpenAPI (`/api/v1/openapi.json`) tem que bater com as rotas que existem em `src/app/api/v1/**`
 * (mesmo caminho, mesmo método) e cada rota precisa ter autenticação, resposta de erro padronizada e documentação.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, buildOpenApi } from "./registry";

const ROOT = path.resolve(__dirname, "../../app/api/v1");

function arquivosDeRota(dir: string, base = ""): Array<{ caminho: string; fonte: string }> {
  const out: Array<{ caminho: string; fonte: string }> = [];
  for (const nome of readdirSync(dir)) {
    const full = path.join(dir, nome);
    if (statSync(full).isDirectory()) out.push(...arquivosDeRota(full, `${base}/${nome}`));
    else if (nome === "route.ts") out.push({ caminho: base || "/", fonte: readFileSync(full, "utf8") });
  }
  return out;
}

const metodosExportados = (fonte: string): string[] => {
  const m = new Set<string>();
  for (const x of fonte.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)) m.add(x[1]!.toLowerCase());
  return [...m];
};

describe("OpenAPI x rotas reais", () => {
  const reais = arquivosDeRota(ROOT).flatMap((r) => metodosExportados(r.fonte).map((m) => `${m} ${r.caminho.replace(/\[(\w+)\]/g, "{$1}")}`)).sort();
  const doc = buildOpenApi() as { paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown>; parameters: Array<{ name: string; in: string }> }>> };
  const documentadas = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m} ${p}`)).sort();

  it("toda rota existente está no OpenAPI e vice-versa", () => {
    expect(documentadas).toEqual(reais);
    expect(reais.length).toBeGreaterThanOrEqual(20);
  });

  it("cada rota do registro aponta para um handler exportado e o arquivo usa esse handler", () => {
    for (const r of ROUTES) {
      const arq = arquivosDeRota(ROOT).find((a) => a.caminho.replace(/\[(\w+)\]/g, "{$1}") === r.path);
      expect(arq, `sem arquivo para ${r.path}`).toBeTruthy();
      if (r.handler !== "openapi" && r.handler !== "arquivoReceita") expect(arq!.fonte, r.path).toContain(`h.${r.handler}`);
    }
  });

  it("parâmetros de caminho do OpenAPI = {param} do caminho; X-Telefone documentado nas rotas de usuário", () => {
    for (const r of ROUTES) {
      const op = doc.paths[r.path]![r.method]!;
      const doCaminho = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(op.parameters.filter((p) => p.in === "path").map((p) => p.name)).toEqual(doCaminho);
      const temTel = op.parameters.some((p) => p.name === "X-Telefone");
      expect(temTel, r.path).toBe(r.auth === "membro" || r.auth === "remetente");
      expect(op.responses["200"], r.path).toBeTruthy();
      expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(["401", "429"]));
    }
  });

  it("operationId único e documento 3.x com esquema de segurança Bearer", () => {
    const ids = ROUTES.map((r) => r.handler);
    expect(new Set(ids).size).toBe(ids.length);
    expect((doc as unknown as { openapi: string }).openapi).toMatch(/^3\./);
    expect(JSON.stringify(doc)).toContain('"scheme":"bearer"');
  });

  it("nenhuma rota fica fora do middleware público apenas por engano: /api/v1 é público no middleware e protegido pelas chaves", () => {
    const mw = readFileSync(path.resolve(__dirname, "../../middleware.ts"), "utf8");
    expect(mw).toContain('"/api/v1"');
  });
});
