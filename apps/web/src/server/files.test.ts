import { beforeAll } from "vitest";
import { signFileUrl, verifyFileSignature } from "./files";

beforeAll(() => {
  process.env["SESSION_SECRET"] = "segredo-de-teste-com-mais-de-16-caracteres";
});

const parse = (url: string) => {
  const u = new URL(url, "http://x");
  return { exp: Number(u.searchParams.get("exp")), m: u.searchParams.get("m")!, v: u.searchParams.get("v")!, sig: u.searchParams.get("sig")! };
};

describe("URL assinada de arquivo de receita", () => {
  const now = 1_800_000_000;

  it("vale para o arquivo, a variante, a pessoa e a família certos, por 10 minutos", async () => {
    const url = await signFileUrl("file-1", "thumb", "mem-1", "fam-1", now);
    expect(url.startsWith("/api/rx-file/file-1?")).toBe(true);
    const { exp, m, v, sig } = parse(url);
    expect(exp).toBe(now + 600);
    expect(await verifyFileSignature("file-1", v, exp, m, "fam-1", sig, now)).toBe(true);
    expect(await verifyFileSignature("file-1", v, exp, m, "fam-1", sig, now + 601)).toBe(false);
  });

  it("não serve a outro arquivo, outra variante, outra pessoa ou outra família", async () => {
    const { exp, m, v, sig } = parse(await signFileUrl("file-1", "thumb", "mem-1", "fam-1", now));
    expect(await verifyFileSignature("file-2", v, exp, m, "fam-1", sig, now)).toBe(false);
    expect(await verifyFileSignature("file-1", "full", exp, m, "fam-1", sig, now)).toBe(false);
    expect(await verifyFileSignature("file-1", v, exp, "mem-2", "fam-1", sig, now)).toBe(false);
    expect(await verifyFileSignature("file-1", v, exp, m, "fam-2", sig, now)).toBe(false);
    expect(await verifyFileSignature("file-1", "huge", exp, m, "fam-1", sig, now)).toBe(false);
  });
});
