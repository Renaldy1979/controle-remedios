import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "../../../integrations/n8n");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

describe("workflows N8N exportados", () => {
  it("há os workflows esperados", () => {
    expect(files.sort()).toEqual(["alertas-operacionais.json", "disparo-agendador.json", "transcricao-audio.json", "whatsapp-entrada.json"]);
  });

  for (const file of files) {
    const raw = readFileSync(join(DIR, file), "utf8");
    const wf = JSON.parse(raw) as {
      nodes: Array<{ name: string; id: string }>;
      connections: Record<string, { main: Array<Array<{ node: string }>> }>;
      active: boolean;
    };

    it(`${file}: JSON válido, conexões apontam para nós existentes, ids únicos, inativo e sem segredos`, () => {
      const names = new Set(wf.nodes.map((n) => n.name));
      expect(names.size).toBe(wf.nodes.length);
      expect(new Set(wf.nodes.map((n) => n.id)).size).toBe(wf.nodes.length);
      for (const [from, out] of Object.entries(wf.connections)) {
        expect(names.has(from)).toBe(true);
        for (const branch of out.main) for (const c of branch) expect(names.has(c.node)).toBe(true);
      }
      expect(wf.active).toBe(false);
      // Segredos só via $env; nada de chave literal.
      expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    });
  }

  it("sem segredos no arquivo: nada de $env, credenciais por nome e marcadores TROQUE nos endereços", () => {
    const names = new Set<string>();
    for (const file of files) {
      const raw = readFileSync(join(DIR, file), "utf8");
      expect(raw).not.toContain("$env");
      for (const m of raw.matchAll(/"name": "([^"]+)" }/g)) if (m[1] !== "medcuidar") names.add(m[1]!);
    }
    expect([...names].sort()).toEqual(["Gemini API Key", "MedCuidar Alertas", "MedCuidar Scheduler", "MedCuidar Webhook Secret", "SMTP MedCuidar"]);
    const entrada = readFileSync(join(DIR, "whatsapp-entrada.json"), "utf8");
    expect(entrada).toContain("TROQUE-ESTE-TOKEN");
    expect(entrada).toContain("TROQUE-PELA-URL");
    expect(entrada).toContain("evolution-go");
  });

  it("o README documenta todas as credenciais usadas", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const n of ["Gemini API Key", "MedCuidar Alertas", "MedCuidar Scheduler", "MedCuidar Webhook Secret", "SMTP MedCuidar"]) expect(readme).toContain(n);
  });
});
