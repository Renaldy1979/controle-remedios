import { hmacHex } from "./hmac";

describe("hmacHex", () => {
  it("é determinístico e depende do segredo e do conteúdo", async () => {
    const a = await hmacHex("a", "segredo-de-teste-com-mais-de-16-caracteres");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await hmacHex("a", "segredo-de-teste-com-mais-de-16-caracteres"));
    expect(a).not.toBe(await hmacHex("a", "outro-segredo-qualquer-123"));
    expect(a).not.toBe(await hmacHex("b", "segredo-de-teste-com-mais-de-16-caracteres"));
  });
});
