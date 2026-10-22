/* eslint-disable @typescript-eslint/no-explicit-any -- manipula JSON de fluxos de forma dinâmica */
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sem tipos
import { FLUXOS } from "./build.mjs";
// @ts-expect-error módulo .mjs sem tipos
import { validarFluxo, validarTudo } from "./validar.mjs";

type No = { name: string; type: string; parameters: Record<string, any>; credentials?: any; onError?: string };
type Fluxo = { nodes: No[]; connections: Record<string, any> };
const gerar = (arq: string): Fluxo => JSON.parse(JSON.stringify(FLUXOS[arq]()));
const erros = (arq: string, wf: Fluxo): string[] => validarFluxo(arq, wf, JSON.stringify(wf));
const no = (wf: Fluxo, nome: string): No => wf.nodes.find((n) => n.name === nome)!;

describe("fluxos gerados", () => {
  it("os 8 arquivos em integrations/n8n/fluxos estão válidos e iguais ao gerador", () => {
    expect(validarTudo()).toEqual([]);
  });
  it("cada fluxo isolado é válido", () => {
    for (const arq of Object.keys(FLUXOS)) expect(erros(arq, gerar(arq)), arq).toEqual([]);
  });
  it("todos são exportados desligados e sem URL real", () => {
    for (const arq of Object.keys(FLUXOS)) {
      const wf = FLUXOS[arq]();
      expect(wf.active).toBe(false);
      expect(JSON.stringify(wf)).not.toMatch(/https?:\/\/(?!COLE-AQUI)/);
    }
  });
});

describe("validador pega o que não pode", () => {
  it("segredo literal", () => {
    const wf = gerar("02-lembretes-dose.json");
    no(wf, "Config").parameters.assignments.assignments.push({ id: "x", name: "nota", value: "Bearer cpl_abcdefghijklmnopqrstuvwxyz0123456789", type: "string" });
    expect(erros("02-lembretes-dose.json", wf).join("\n")).toMatch(/segredo|chave de plataforma|token Bearer/);
  });
  it("URL fora do Config", () => {
    const wf = gerar("02-lembretes-dose.json");
    no(wf, "Busca da fila").parameters.url = "https://portal.exemplo.com/api/v1/lembretes/pendentes";
    expect(erros("02-lembretes-dose.json", wf).join("\n")).toMatch(/URL literal/);
  });
  it("$env", () => {
    const wf = gerar("01-conversa.json");
    no(wf, "Normaliza").parameters.jsCode += "\nconst k = $env.CHAVE;";
    expect(erros("01-conversa.json", wf).join("\n")).toMatch(/\$env/);
  });
  it("tipo de nó ou typeVersion ausentes e conexão para nó inexistente", () => {
    const wf = gerar("05-teste-conexao.json");
    delete (no(wf, "Recusa") as any).typeVersion;
    wf.connections["Recusa"] = { main: [[{ node: "Fantasma", type: "main", index: 0 }]] };
    const e = erros("05-teste-conexao.json", wf).join("\n");
    expect(e).toMatch(/sem typeVersion/);
    expect(e).toMatch(/destino inexistente/);
  });
  it("nó solto", () => {
    const wf = gerar("05-teste-conexao.json");
    wf.nodes.push({ name: "Solto", type: "n8n-nodes-base.noOp", typeVersion: 1, position: [0, 0], parameters: {} } as any);
    expect(erros("05-teste-conexao.json", wf).join("\n")).toMatch(/"Solto" sem conexão/);
  });
  it("credencial errada na API e chamada que segue redirect", () => {
    const wf = gerar("02-lembretes-dose.json");
    no(wf, "Busca da fila").credentials = { httpHeaderAuth: { id: "x", name: "Outra" } };
    no(wf, "Marca falha").parameters.options.redirect.redirect.followRedirects = true;
    const e = erros("02-lembretes-dose.json", wf).join("\n");
    expect(e).toMatch(/sem a credencial "MedCuidar API"/);
    expect(e).toMatch(/segue redirect/);
  });
  it("lembrete marcado como enviado fora do ramo de envio OK", () => {
    const wf = gerar("02-lembretes-dose.json");
    wf.connections["Envio ok?"].main[1] = [{ node: "Marca enviada", type: "main", index: 0 }];
    expect(erros("02-lembretes-dose.json", wf).join("\n")).toMatch(/"Marca enviada" só pode vir/);
  });
  it("fluxo de agenda sem tratamento de erro", () => {
    const wf = gerar("02-lembretes-dose.json");
    delete no(wf, "Busca da fila").onError;
    wf.connections["Busca da fila"].main = [wf.connections["Busca da fila"].main[0]];
    for (const n of wf.nodes) if (n.type === "n8n-nodes-base.httpRequest") delete n.onError;
    expect(erros("02-lembretes-dose.json", wf).join("\n")).toMatch(/sem tratamento de erro/);
  });
  it("código de nó com sintaxe quebrada ou lib desatualizada", () => {
    const wf = gerar("01-conversa.json");
    no(wf, "Normaliza").parameters.jsCode += "\nconst = ;";
    expect(erros("01-conversa.json", wf).join("\n")).toMatch(/erro de sintaxe/);
    const wf2 = gerar("01-conversa.json");
    no(wf2, "Normaliza").parameters.jsCode = no(wf2, "Normaliza").parameters.jsCode.replace("const soDigitos", "const soDigitosX");
    expect(erros("01-conversa.json", wf2).join("\n")).toMatch(/lib desatualizada/);
  });
  it("webhook de mensagens com autenticação ou caminho fraco", () => {
    const wf = gerar("01-conversa.json");
    no(wf, "Webhook Evolution").parameters.path = "whatsapp";
    expect(erros("01-conversa.json", wf).join("\n")).toMatch(/caminho medcuidar/);
  });
  it("conversa sem X-Telefone do remetente", () => {
    const wf = gerar("01-conversa.json");
    no(wf, "Conversa (API)").parameters.headerParameters.parameters[0].value = "={{ $json.corpo.telefone }}";
    expect(erros("01-conversa.json", wf).join("\n")).toMatch(/X-Telefone = remetente/);
  });
});

describe("agente de IA só lê e nunca recebe telefone", () => {
  const ferramentas = (wf: Fluxo) => wf.nodes.filter((n) => n.type.endsWith("toolHttpRequest"));
  it("há cinco ferramentas GET, todas com X-Telefone fixado pelo fluxo", () => {
    const wf = gerar("01b-agente.json");
    expect(ferramentas(wf)).toHaveLength(5);
    for (const f of ferramentas(wf)) {
      expect(f.parameters.method).toBe("GET");
      expect(f.parameters.parametersHeaders.values[0]).toMatchObject({ name: "X-Telefone", valueProvider: "fieldValue", value: "={{ $('Entrada do 01').first().json.telefone }}" });
    }
  });
  it("ferramenta com parâmetro de telefone é recusada", () => {
    const wf = gerar("01b-agente.json");
    no(wf, "estoque").parameters.sendQuery = true;
    no(wf, "estoque").parameters.parametersQuery = { values: [{ name: "telefone", valueProvider: "modelRequired" }] };
    expect(erros("01b-agente.json", wf).join("\n")).toMatch(/parâmetro de telefone/);
  });
  it("ferramenta que escreve (POST, corpo ou rota de confirmação) é recusada", () => {
    const wf = gerar("01b-agente.json");
    no(wf, "estoque").parameters.method = "POST";
    no(wf, "proximas_doses").parameters.url = "={{ $('Config').first().json.apiBase }}/doses/123/confirmar";
    const e = erros("01b-agente.json", wf).join("\n");
    expect(e).toMatch(/não é GET/);
    expect(e).toMatch(/fora da lista de leitura/);
    expect(e).toMatch(/rota de escrita/);
  });
  it("X-Telefone escolhido pela IA ou ausente é recusado", () => {
    const wf = gerar("01b-agente.json");
    no(wf, "estoque").parameters.parametersHeaders.values[0].valueProvider = "modelRequired";
    delete no(wf, "reposicoes_abertas").parameters.parametersHeaders;
    const e = erros("01b-agente.json", wf).join("\n");
    expect(e).toMatch(/deixa a IA escolher o cabeçalho/);
    expect(e).toMatch(/sem X-Telefone fixado/);
  });
  it("outro tipo de ferramenta (ex.: código) é recusado", () => {
    const wf = gerar("01b-agente.json");
    no(wf, "estoque").type = "@n8n/n8n-nodes-langchain.toolCode";
    expect(erros("01b-agente.json", wf).join("\n")).toMatch(/não é HTTP/);
  });
});
