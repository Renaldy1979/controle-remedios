// @vitest-environment node
import { describe, expect, it } from "vitest";
import { quantityText } from "../pg/calc";
import { interpretText } from "./interpret";
import * as T from "./texts";

const linha = (over: Partial<T.EstoqueLinha> = {}): T.EstoqueLinha => ({
  paciente: "Adelino", remedio: "Zypred", dias: 11, nivel: "ok", estimativa: false, quantidade: quantityText(11, "unit", "tablet", null), ...over,
});

describe("quantidade restante nas mensagens (mesma regra do portal: quantityText)", () => {
  it("comprimido, unidade, líquido, pó e colírio formatam como no portal", () => {
    expect(quantityText(11, "unit", "tablet", null)).toBe("11 comprimidos");
    expect(quantityText(1, "unit", "tablet", null)).toBe("1 comprimido");
    expect(quantityText(3, "unit", "injection", null)).toBe("3 unidades");
    expect(quantityText(120, "ml", "oral_liquid", null)).toBe("≈ 120 ml");
    expect(quantityText(200, "gram", "ointment", null)).toBe("200 g");
    expect(quantityText(36, "drop", "eye_drops", 20)).toBe("≈ 1,8 ml · 36 gotas");
  });

  it("resposta de 'estoque' traz a quantidade e os dias, por unidade", () => {
    const r = T.estoque([
      linha(),
      linha({ remedio: "Xarope", quantidade: quantityText(120, "ml", "oral_liquid", null), dias: 20 }),
      linha({ remedio: "Pomada", quantidade: quantityText(200, "gram", "ointment", null), dias: 40, nivel: "warning" }),
    ]).texto;
    expect(r).toContain("Adelino — Zypred: 11 comprimidos · 11 dias de estoque");
    expect(r).toContain("Xarope: ≈ 120 ml · 20 dias de estoque");
    expect(r).toContain("Pomada: 200 g · 40 dias de estoque");
  });

  it("colírio: gotas e ml com a nota de estimativa", () => {
    const r = T.estoque([linha({ remedio: "Lacrima", quantidade: quantityText(36, "drop", "eye_drops", 20), dias: 9, estimativa: true })]).texto;
    expect(r).toContain("Lacrima: ≈ 1,8 ml · 36 gotas · 9 dias de estoque (estimativa)");
    expect(r).toContain("Estimativa: colírio varia com a gota");
  });

  it("sem quantidade conhecida o texto antigo continua igual", () => {
    expect(T.estoque([linha({ quantidade: undefined })]).texto).toContain("Adelino — Zypred: 11 dias de estoque");
  });

  it("aviso de estoque baixo diz quantos restam", () => {
    const r = T.estoqueBaixo({ paciente: "Adelino", remedio: "Zypred", dias: 3, estimativa: false, quantidade: "11 comprimidos" }).texto;
    expect(r).toContain("Estoque baixo — Adelino");
    expect(r).toContain("Restam 11 comprimidos (3 dias).");
    const col = T.estoqueBaixo({ paciente: "Maria", remedio: "Lacrima", dias: 2, estimativa: true, quantidade: "≈ 1,8 ml · 36 gotas" }).texto;
    expect(col).toContain("Restam ≈ 1,8 ml · 36 gotas (2 dias).");
    expect(col).toContain("Estimativa");
    expect(T.estoqueBaixo({ paciente: "Adelino", remedio: "Zypred", dias: 3, estimativa: false }).texto).not.toContain("Restam");
  });

  it("resumo diário e estoques críticos trazem a quantidade", () => {
    const r = T.resumoDiario({
      data: "26/10/2026", pacientes: [{ nome: "Adelino", tomadas: 2, esquecidas: 0, pendentes: 1 }],
      estoqueCritico: [linha({ dias: 2, nivel: "critical", quantidade: "3 comprimidos" })],
    }).texto;
    expect(r).toContain("Estoque crítico");
    expect(r).toContain("Adelino — Zypred: 3 comprimidos · 2 dias de estoque");
  });

  it("estoque de remédio citado que não tem estoque cadastrado", () => {
    expect(T.estoqueNaoEncontrado(["Losartana"]).texto).toContain("Não há estoque cadastrado para Losartana");
  });
});

describe("intenção: perguntas de quantidade caem em 'estoque'", () => {
  it.each([
    "quantos comprimidos de losartana eu tenho?",
    "Quanto resta do zypred",
    "quanto tenho de losartana?",
    "quantidade em estoque",
    "qual a quantidade restante?",
    "quantos comprimidos ainda tem do zypred",
    "quantas gotas restam do colírio",
    "estoque",
  ])("%s", (frase) => {
    expect(interpretText(frase)).toBe("estoque");
  });
  it("pergunta de DOSE ou de horário não vira estoque", () => {
    expect(interpretText("quantos comprimidos eu devo tomar?")).not.toBe("estoque");
    expect(interpretText("quantos comprimidos eu tomo por dia")).not.toBe("estoque");
    expect(interpretText("próximas doses")).toBe("proximas_doses");
    expect(interpretText("quanto falta tomar hoje?")).not.toBe("estoque");
  });
});
