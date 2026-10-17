import { hmacHex, signSession, verifySession } from "./session-token";

const SECRET = "segredo-de-teste-com-mais-de-16-caracteres";
const now = 1_800_000_000;

describe("token de sessão", () => {
  it("assina e confere, devolvendo família e membro", async () => {
    const t = await signSession({ f: "fam-1", m: "mem-1", exp: now + 60 }, SECRET);
    expect(await verifySession(t, SECRET, now)).toEqual({ f: "fam-1", m: "mem-1", exp: now + 60 });
  });

  it("recusa token adulterado, com outro segredo, vencido ou ausente", async () => {
    const t = await signSession({ f: "fam-1", m: "mem-1", exp: now + 60 }, SECRET);
    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ f: "outra-familia", m: "mem-1", exp: now + 60 })).replace(/=+$/, "");
    expect(await verifySession(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(await verifySession(`${body}.${sig!.slice(0, -2)}AA`, SECRET, now)).toBeNull();
    expect(await verifySession(t, "outro-segredo-qualquer-123", now)).toBeNull();
    expect(await verifySession(t, SECRET, now + 61)).toBeNull();
    expect(await verifySession(undefined, SECRET, now)).toBeNull();
    expect(await verifySession("lixo", SECRET, now)).toBeNull();
  });

  it("hmacHex é determinístico e depende do segredo", async () => {
    expect(await hmacHex("a", SECRET)).toBe(await hmacHex("a", SECRET));
    expect(await hmacHex("a", SECRET)).not.toBe(await hmacHex("a", "outro-segredo-qualquer-123"));
  });
});
