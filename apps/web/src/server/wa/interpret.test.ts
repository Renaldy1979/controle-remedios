import { describe, expect, it } from "vitest";
import { findMentions, interpretText, parseCode, parseOption } from "./interpret";

describe("interpretação de mensagens", () => {
  it("código de verificação, com ou sem a palavra", () => {
    expect(parseCode("123456")).toBe("123456");
    expect(parseCode("CÓDIGO 123456")).toBe("123456");
    expect(parseCode("codigo: 123 456")).toBe("123456");
    expect(parseCode("Código 12345")).toBeNull();
    expect(parseCode("tomei 123456")).toBeNull();
    expect(interpretText("CÓDIGO 654321")).toBe("codigo");
  });

  it("opções numeradas", () => {
    expect(parseOption("1")).toBe(1);
    expect(parseOption(" 2. ")).toBe(2);
    expect(parseOption("12")).toBeNull();
    expect(parseOption("tomei 1")).toBeNull();
    expect(interpretText("3)")).toBe("opcao");
  });

  it.each(["ok", "OK", "👍🏽", "✅", "✔️", "feito", "já tomou", "tomei", "Tomei o Zypred"])("'%s' confirma dose", (t) => {
    expect(interpretText(t)).toBe("dose_tomada");
  });

  it.each([
    ["não tomei", "nao_tomou"], ["ainda não tomou", "nao_tomou"],
    ["eu cuido disso", "eu_cuido"], ["eu compro", "eu_cuido"],
    ["lembrar de novo", "lembrar_depois"], ["me lembra mais tarde", "lembrar_depois"], ["depois", "lembrar_depois"],
    ["estoque", "estoque"], ["como está o estoque?", "estoque"], ["vai acabar o remédio?", "estoque"],
    ["próximas doses", "proximas_doses"], ["que horas é o próximo remédio", "proximas_doses"],
    ["já tomou o zypred?", "dose_status"],
    ["me manda o link de acesso", "link_acesso"],
    ["oi", "ajuda"], ["ajuda", "ajuda"],
    ["quanto custa o plano de saúde?", "livre"], ["", "livre"],
  ])("'%s' → %s", (t, intent) => {
    expect(interpretText(t)).toBe(intent);
  });

  it("'ok, e o estoque?' pergunta de estoque, não confirmação", () => {
    expect(interpretText("ok, e o estoque?")).toBe("estoque");
  });

  it("acha remédio e paciente citados", () => {
    const m = findMentions("tomei o Zypred do Adelino", [{ id: "p1", name: "Adelino Souza" }, { id: "p2", name: "Maria" }], [{ id: "m1", name: "Zypred", alternativeNames: ["Prednisolona"] }, { id: "m2", name: "Losartana" }]);
    expect(m).toEqual({ medicationIds: ["m1"], patientIds: ["p1"] });
  });
});
