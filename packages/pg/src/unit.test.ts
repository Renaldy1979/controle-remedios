import { describe, expect, it } from "vitest";
import { uuidDeterministico } from "./ids";
import { gerarTokenPrimeiroAcesso, gerarApiKey, gerarCodigoVerificacao, hashCodigoVerificacao, sha256 } from "./crypto";
import { withFamilia } from "./withFamilia";
import { FAMILY_TABLES } from "./schema";
import { adminUrl, appUrl } from "./env";

describe("uuidDeterministico", () => {
  it("é estável, diferente por nome e tem formato de UUID v5", () => {
    expect(uuidDeterministico("a")).toBe(uuidDeterministico("a"));
    expect(uuidDeterministico("a")).not.toBe(uuidDeterministico("b"));
    expect(uuidDeterministico("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("crypto", () => {
  it("sha256 conhecido", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("código tem 6 dígitos e hash de 64 hex que muda com o código", () => {
    const c = gerarCodigoVerificacao();
    expect(c).toMatch(/^\d{6}$/);
    expect(hashCodigoVerificacao(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCodigoVerificacao("000000")).not.toBe(hashCodigoVerificacao("000001"));
  });
  it("chaves têm prefixo certo, entropia e só o hash identifica", () => {
    const f = gerarApiKey("familia");
    const p = gerarApiKey("plataforma");
    expect(f.chave.startsWith("cdf_")).toBe(true);
    expect(p.chave.startsWith("cpl_")).toBe(true);
    expect(f.hash).toBe(sha256(f.chave));
    expect(f.chave).not.toBe(gerarApiKey("familia").chave);
    expect(f.chave.length).toBeGreaterThan(40);
  });
});

describe("withFamilia", () => {
  it("recusa id que não é UUID antes de tocar no banco", async () => {
    await expect(withFamilia("x'; drop table families; --", async () => 1)).rejects.toThrow("familiaId inválido");
    await expect(withFamilia("", async () => 1)).rejects.toThrow("familiaId inválido");
  });
});

describe("env", () => {
  it("URLs de desenvolvimento têm formato postgres:// e papéis diferentes", () => {
    expect(appUrl()).toMatch(/^postgres(ql)?:\/\//);
    expect(adminUrl()).toMatch(/^postgres(ql)?:\/\//);
    expect(appUrl()).not.toBe(adminUrl());
  });
});

describe("schema", () => {
  it("lista as tabelas com family_id sem duplicatas", () => {
    expect(new Set(FAMILY_TABLES).size).toBe(FAMILY_TABLES.length);
  });
});

describe("token do link de primeiro acesso", () => {
  it("só tem 0-9a-f (sem _ nem -, que o WhatsApp lê como formatação) e o hash bate", () => {
    for (let i = 0; i < 500; i++) {
      const { token, hash } = gerarTokenPrimeiroAcesso();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).toBe(sha256(token));
    }
  });
});
