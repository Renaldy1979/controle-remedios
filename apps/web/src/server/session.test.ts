import { pickFamily, type Membership } from "./session";

const m = (familyId: string): Membership => ({ familyId, memberId: `m-${familyId}`, familyName: `Família ${familyId}` });

describe("qual família abrir", () => {
  it("sem cadastro ativo em nenhuma família: ninguém entra", () => {
    expect(pickFamily([], undefined)).toBeNull();
    expect(pickFamily([], "fam-a")).toBeNull();
  });

  it("uma única família abre direto (mesmo sem escolha)", () => {
    expect(pickFamily([m("a")], undefined)).toEqual(m("a"));
  });

  it("mais de uma família exige escolher", () => {
    expect(pickFamily([m("a"), m("b")], undefined)).toBe("choose");
  });

  it("a escolha vale só se for uma das famílias DA PESSOA (cookie forjado não abre outra família)", () => {
    expect(pickFamily([m("a"), m("b")], "b")).toEqual(m("b"));
    expect(pickFamily([m("a"), m("b")], "outra-familia")).toBe("choose");
    expect(pickFamily([m("a")], "outra-familia")).toEqual(m("a"));
  });
});
