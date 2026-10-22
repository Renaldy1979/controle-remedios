// @vitest-environment node
import { describe, expect, it } from "vitest";
import { criarFake } from "./provider/fake";
import { criarRitmo, pausaDigitandoMs, type Relogio } from "./ritmo";
import { PRECOS, custoMicros } from "./ia/precos";
import { FERRAMENTAS_AGENTE, NOMES_FERRAMENTAS, PROMPT_AGENTE } from "./ia/prompt";
import { logWa } from "./log";
import { vi } from "vitest";

/** Relógio de mentira: o sono avança o tempo e registra a pausa pedida. */
function relogioFalso(aleatorio = 0.5) {
  let t = 1_000_000;
  const pausas: number[] = [];
  const r: Relogio = { agora: () => t, dormir: async (ms) => { pausas.push(ms); t += ms; }, aleatorio: () => aleatorio };
  return { r, pausas, agora: () => t };
}

describe("ritmo de envio (anti-bloqueio)", () => {
  it("a pausa antes de toda resposta fica entre 2 e 6 s", () => {
    for (let i = 0; i <= 100; i++) {
      const ms = pausaDigitandoMs(() => i / 100);
      expect(ms).toBeGreaterThanOrEqual(2000);
      expect(ms).toBeLessThanOrEqual(6000);
    }
    expect(pausaDigitandoMs(() => 0)).toBe(2000);
    expect(pausaDigitandoMs(() => 0.999)).toBe(6000);
  });

  it("toda mensagem: presença 'digitando…' ANTES, pausa aleatória e só então o envio", async () => {
    const { r, pausas } = relogioFalso(0.5);
    const f = criarFake();
    const ordem: string[] = [];
    const orig = f.presenca;
    f.presenca = async (n) => { ordem.push("presenca"); await orig(n); };
    const env = f.enviarTexto;
    f.enviarTexto = async (n, t) => { ordem.push("envio"); return env(n, t); };
    await criarRitmo({ relogio: r, maxPorMinuto: 100, maxPorHora: 100 }).enviar(f, "5511912345678", "oi");
    expect(ordem).toEqual(["presenca", "envio"]);
    expect(pausas).toEqual([4000]);
    expect(f.enviados).toHaveLength(1);
  });

  it("falha da presença nunca impede a resposta", async () => {
    const { r } = relogioFalso();
    const f = criarFake();
    f.presenca = async () => { throw new Error("sem presença"); };
    await criarRitmo({ relogio: r }).enviar(f, "5511912345678", "oi");
    expect(f.enviados).toHaveLength(1);
  });

  it("teto por minuto: a 3ª mensagem espera a janela de 60 s correr", async () => {
    const { r, pausas, agora } = relogioFalso();
    const f = criarFake();
    const ritmo = criarRitmo({ relogio: r, maxPorMinuto: 2, maxPorHora: 100 });
    const inicio = agora();
    for (let i = 0; i < 3; i++) await ritmo.enviar(f, "5511912345678", `m${i}`);
    expect(f.enviados).toHaveLength(3);
    // a terceira só sai depois que a primeira saiu da janela de 60 s
    expect(agora() - inicio).toBeGreaterThanOrEqual(60_000);
    expect(pausas.some((p) => p > 10_000)).toBe(true);
  });

  it("teto por hora também vale", async () => {
    const { r, agora } = relogioFalso(0);
    const f = criarFake();
    const ritmo = criarRitmo({ relogio: r, maxPorMinuto: 100, maxPorHora: 3 });
    const inicio = agora();
    for (let i = 0; i < 4; i++) await ritmo.enviar(f, "5511912345678", `m${i}`);
    expect(agora() - inicio).toBeGreaterThanOrEqual(3_600_000 - 20_000);
  });

  it("escalonamento: pausa extra de 1 a 3 s só quando o destinatário muda", async () => {
    const { r, pausas } = relogioFalso(0.5);
    const ritmo = criarRitmo({ relogio: r });
    await ritmo.escalonar("5511911111111");
    expect(pausas).toEqual([]);
    await ritmo.escalonar("5511911111111");
    expect(pausas).toEqual([]);
    await ritmo.escalonar("5511922222222");
    expect(pausas).toHaveLength(1);
    expect(pausas[0]).toBeGreaterThanOrEqual(1000);
    expect(pausas[0]).toBeLessThanOrEqual(3000);
  });
});

describe("custo de IA", () => {
  it("Sonnet 5.5: US$ 2/10 por milhão, cache lido a 0,20 e escrito a 2,50", () => {
    expect(PRECOS["claude-sonnet-5-5"]).toMatchObject({ entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 });
    // 1000 de entrada ($0,002) + 200 de saída ($0,002) + 4000 de cache lido ($0,0008)
    expect(custoMicros("claude-sonnet-5-5", { entrada: 1000, saida: 200, cacheLeitura: 4000 })).toEqual({ micros: 4800, estimado: false });
  });
  it("modelo fora da tabela não perde o uso: custo 0 marcado como estimado", () => {
    expect(custoMicros("modelo-novo", { entrada: 10, saida: 10 })).toEqual({ micros: 0, estimado: true });
  });
});

describe("agente: prompt e ferramentas (cache e segurança)", () => {
  it("nenhuma ferramenta escreve e nenhuma recebe telefone, membro ou família", () => {
    const proibidos = /confirm|desfaz|compr|ajust|assum|avanc|criar|apagar|excluir|registrar|salvar|gravar|enviar|alterar/i;
    for (const f of FERRAMENTAS_AGENTE) {
      expect(f.name, f.name).not.toMatch(proibidos);
      const campos = Object.keys(f.input_schema.properties);
      for (const c of campos) expect(c, `${f.name}.${c}`).not.toMatch(/telefone|phone|membro|member|familia|family|id$/i);
      expect(f.input_schema.additionalProperties).toBe(false);
    }
    expect(NOMES_FERRAMENTAS).toEqual(["consultar_estoque", "proximas_doses", "doses_do_dia", "status_da_dose", "reposicoes_abertas", "receita_vigente"]);
  });
  it("o prompt do sistema é constante: sem data, hora, id nem nome; e proíbe conselho médico e escrita", () => {
    expect(PROMPT_AGENTE).not.toMatch(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}|[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(PROMPT_AGENTE).toMatch(/NUNCA dê conselho médico/);
    expect(PROMPT_AGENTE).toMatch(/NÃO escreve nada/);
    expect(PROMPT_AGENTE.length).toBeGreaterThan(1500);
  });
  it("o log do WhatsApp descarta campos com conteúdo e telefone", () => {
    const espiao = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWa({ etapa: "x", texto: "tomei", telefone: "5511912345678", body: "b", msgId: "abc", erro: "falha com 5511912345678 no meio" });
    const linha = String(espiao.mock.calls.at(-1)?.[0]);
    espiao.mockRestore();
    expect(linha).toContain('"msgId":"abc"');
    expect(linha).not.toContain("tomei");
    expect(linha).not.toContain("5511912345678");
  });
});
