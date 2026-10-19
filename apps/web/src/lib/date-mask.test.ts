import { describe, expect, it } from "vitest";
import { maskDate } from "./date-mask";

describe("maskDate", () => {
  it("coloca as barras sozinha enquanto digita", () => {
    expect(maskDate("1")).toBe("1");
    expect(maskDate("10")).toBe("10");
    expect(maskDate("100")).toBe("10/0");
    expect(maskDate("1003")).toBe("10/03");
    expect(maskDate("10031")).toBe("10/03/1");
    expect(maskDate("10031942")).toBe("10/03/1942");
  });

  it("aceita colar já formatado ou com lixo e limita a 10 caracteres", () => {
    expect(maskDate("10/03/1942")).toBe("10/03/1942");
    expect(maskDate("10-03-1942 abc")).toBe("10/03/1942");
    expect(maskDate("100319421234")).toBe("10/03/1942");
  });

  it("apagar a barra não trava: o texto é refeito dos dígitos", () => {
    expect(maskDate("10/0")).toBe("10/0");
    expect(maskDate("10/")).toBe("10");
    expect(maskDate("")).toBe("");
  });
});
