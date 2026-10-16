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
      expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|apikey"\s*:\s*"[^=]/i);
    });
  }

  it("a entrada assina o corpo e envia o mesmo texto assinado", () => {
    const wf = JSON.parse(readFileSync(join(DIR, "whatsapp-entrada.json"), "utf8")) as { nodes: Array<{ name: string; parameters: Record<string, unknown> }> };
    const sign = wf.nodes.find((n) => n.name === "Assinar corpo")!;
    expect(String(sign.parameters["jsCode"])).toContain("createHmac('sha256'");
    const call = wf.nodes.find((n) => n.name === "Chamar whatsapp-inbound")!;
    expect(call.parameters["body"]).toBe("={{ $json.rawBody }}");
  });
});
