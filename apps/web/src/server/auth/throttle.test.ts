import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { bloqueadoPor, registrarFalha, registrarSucesso, zerarLimites } from "./throttle";

describe("limite de tentativas de login", () => {
  beforeEach(() => zerarLimites());

  it("trava o e-mail depois de 8 erros e libera depois de 15 minutos", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 7; i++) registrarFalha("a@x.test", "1.1.1.1", t0);
    expect(bloqueadoPor("a@x.test", "1.1.1.1", t0)).toBe(0);
    registrarFalha("a@x.test", "1.1.1.1", t0);
    expect(bloqueadoPor("a@x.test", "1.1.1.1", t0)).toBe(15);
    expect(bloqueadoPor("a@x.test", "1.1.1.1", t0 + 14 * 60_000)).toBe(1);
    expect(bloqueadoPor("a@x.test", "1.1.1.1", t0 + 15 * 60_000 + 1)).toBe(0);
  });

  it("outro e-mail do mesmo endereço continua livre até o limite do endereço", () => {
    for (let i = 0; i < 8; i++) registrarFalha("a@x.test", "2.2.2.2");
    expect(bloqueadoPor("b@x.test", "2.2.2.2")).toBe(0);
    for (let i = 0; i < 32; i++) registrarFalha(`u${i}@x.test`, "2.2.2.2");
    expect(bloqueadoPor("b@x.test", "2.2.2.2")).toBeGreaterThan(0);
  });

  it("login certo zera o contador do e-mail", () => {
    for (let i = 0; i < 5; i++) registrarFalha("c@x.test", "3.3.3.3");
    registrarSucesso("c@x.test");
    for (let i = 0; i < 7; i++) registrarFalha("c@x.test", "3.3.3.3");
    expect(bloqueadoPor("c@x.test", "3.3.3.3")).toBe(0);
  });

  it("sem endereço (cabeçalho ausente) só vale o limite por e-mail", () => {
    for (let i = 0; i < 8; i++) registrarFalha("d@x.test", "");
    expect(bloqueadoPor("d@x.test", "")).toBeGreaterThan(0);
    expect(bloqueadoPor("e@x.test", "")).toBe(0);
  });
});
