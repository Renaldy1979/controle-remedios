import { describe, expect, it } from "vitest";
import { normalizePhone, formatPhone, maskPhone } from "./phone";
import { validateScheme, type PhaseInput } from "./scheme";
import { intervalTimes } from "./times";

const ph = (everyHours: number, fromDay: number, toDay: number | null, perDose = 1): PhaseInput => ({ everyHours, fromDay, toDay, perDose });

describe("validateScheme (regras de fases, com @medcuidar/domain)", () => {
  it("aceita fase única até acabar", () => {
    expect(validateScheme([ph(8, 1, null)], "08:00")).toEqual({ ok: true, errors: [] });
  });

  it("aceita o Zypred: 3 em 3 h por 15 dias, depois 6 em 6 h até acabar", () => {
    expect(validateScheme([ph(3, 1, 15), ph(6, 16, null, 2)], "06:00").ok).toBe(true);
  });

  it("aceita fase final com duração definida", () => {
    expect(validateScheme([ph(6, 1, 7), ph(12, 8, 14)], "08:00").ok).toBe(true);
  });

  it.each([
    ["sem fases", [], /ao menos uma fase/],
    ["mais de 6 fases", [1, 2, 3, 4, 5, 6, 7].map((d) => ph(8, d, d)), /no máximo 6/],
    ["não começa no dia 1", [ph(8, 2, null)], /dia 1/],
    ["lacuna entre fases", [ph(3, 1, 10), ph(6, 13, null)], /falta cobrir o dia 11 até o dia 12/],
    ["sobreposição", [ph(3, 1, 10), ph(6, 8, null)], /não podem se sobrepor/],
    ["fase aberta no meio", [ph(3, 1, null), ph(6, 5, null)], /só a última fase pode ficar sem dia final/],
    ["fim antes do início", [ph(8, 5, 3)], /dia final não pode ser antes/],
    ["intervalo zero", [ph(0, 1, null)], /quantas em quantas horas/],
    ["intervalo maior que um dia", [ph(30, 1, null)], /quantas em quantas horas/],
    ["dose zero", [ph(8, 1, null, 0)], /maior que zero/],
    ["dose negativa", [ph(8, 1, null, -1)], /maior que zero/],
    ["dia não inteiro", [ph(8, 1.5, null)], /dia inicial/],
  ])("recusa %s", (_nome, phases, mensagem) => {
    const r = validateScheme(phases as PhaseInput[], "08:00");
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(mensagem);
  });

  it.each(["", "8:00", "24:00", "08:60", "abc"])("recusa primeiro horário inválido %j", (t) => {
    expect(validateScheme([ph(8, 1, null)], t).ok).toBe(false);
  });

  it("aceita primeiro horário no fim do dia (ainda gera uma dose pelo domínio)", () => {
    expect(validateScheme([ph(1, 1, null)], "23:59").ok).toBe(true);
  });
});

describe("intervalTimes", () => {
  it("gera os horários do dia", () => {
    expect(intervalTimes("06:00", 6)).toEqual(["06:00", "12:00", "18:00"]);
    expect(intervalTimes("08:00", 24)).toEqual(["08:00"]);
    expect(intervalTimes("00:00", 8)).toEqual(["00:00", "08:00", "16:00"]);
  });
  it("devolve vazio para entrada inválida", () => {
    expect(intervalTimes("25:00", 6)).toEqual([]);
    expect(intervalTimes("08:00", 0)).toEqual([]);
  });
});

describe("telefone", () => {
  it("normaliza para só dígitos com 55", () => {
    expect(normalizePhone("(11) 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("+55 11 91234-5678")).toBe("5511912345678");
    expect(normalizePhone("1134567890")).toBe("551134567890");
    expect(normalizePhone("005511912345678")).toBe("5511912345678");
  });
  it("recusa curto, vazio e texto", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  it("formata e mascara", () => {
    expect(formatPhone("5511912345678")).toBe("(11) 91234-5678");
    expect(maskPhone("5511912345678")).toBe("(••) •••••-5678");
  });
});
