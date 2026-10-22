// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { SYSTEM_PROFILES, can } from "@medcuidar/shared";
import { _limparLimites, canonico, limiteExcedido } from "../api/core";
import { effectivePermissions } from "./actor";
import { separarId } from "./fila";
import * as T from "./texts";

const perms = (n: string) => SYSTEM_PROFILES.find((p) => p.name === n)!.permissions;

describe("permissões pelo WhatsApp conforme o estado de acesso", () => {
  it("active mantém tudo do perfil", () => {
    const e = effectivePermissions("active", "Familiar", perms("Familiar"));
    expect(can(e, "prescriptions.view")).toBe(true);
    expect(can(e, "replenishment.manage")).toBe(true);
  });
  it("whatsapp_verified: só dar o check, ver próxima dose e estoque; nada de receitas, reposição ou administração", () => {
    const e = effectivePermissions("whatsapp_verified", "Familiar", perms("Familiar"));
    expect(can(e, "doses.confirm")).toBe(true);
    expect(can(e, "dashboard.view")).toBe(true);
    expect(can(e, "stock.view")).toBe(true);
    for (const k of ["prescriptions.view", "prescriptions.share", "replenishment.manage", "stock.adjust", "members.manage", "settings.manage"] as const) {
      expect(can(e, k), k).toBe(false);
    }
  });
  it("Administrador em whatsapp_verified NÃO herda o 'tudo' (o nome do perfil libera tudo em can())", () => {
    const e = effectivePermissions("whatsapp_verified", "Administrador", perms("Administrador"));
    expect(e.profileName).not.toBe("Administrador");
    expect(can(e, "doses.confirm")).toBe(true);
    expect(can(e, "prescriptions.view")).toBe(false);
    expect(can(e, "members.manage")).toBe(false);
  });
  it("invited não pode nada", () => {
    const e = effectivePermissions("invited", "Administrador", perms("Administrador"));
    expect(can(e, "doses.confirm")).toBe(false);
    expect(can(e, "dashboard.view")).toBe(false);
  });
  it("perfil sem a permissão no mapa continua sem ela mesmo no básico", () => {
    const e = effectivePermissions("whatsapp_verified", "Cuidadora", { "doses.confirm": true });
    expect(can(e, "doses.confirm")).toBe(true);
    expect(can(e, "stock.view")).toBe(false);
  });
});

describe("textos prontos", () => {
  afterEach(() => {
    delete process.env["SUPPORTS_BUTTONS"];
  });
  it("lembrete de dose: nome do paciente, hora, uma ação, opções numeradas como padrão", () => {
    const r = T.lembreteDose({ paciente: "Adelino", remedio: "Zypred", hora: "08:00", dose: "2 gotas" });
    expect(r.texto).toContain("Adelino");
    expect(r.texto).toContain("Zypred, 2 gotas, às 08:00");
    expect(r.texto).toContain("*1* — Tomei");
    expect(r.texto).toContain("*2* — Lembrar em 15 min");
    expect(r.opcoes).toEqual([{ numero: 1, rotulo: "Tomei" }, { numero: 2, rotulo: "Lembrar em 15 min" }]);
  });
  it("com SUPPORTS_BUTTONS=true o texto não repete as linhas numeradas, mas as opções seguem na resposta", () => {
    process.env["SUPPORTS_BUTTONS"] = "true";
    const r = T.lembreteDose({ paciente: "Adelino", remedio: "Zypred", hora: "08:00" });
    expect(r.texto).not.toContain("*1* —");
    expect(r.opcoes).toHaveLength(2);
  });
  it("dose atrasada, esquecida (família), estoque baixo, receita e resumo trazem o nome do paciente", () => {
    expect(T.lembreteDose({ paciente: "Maria", remedio: "X", hora: "09:00", atrasada: true }).texto).toContain("Dose atrasada — Maria");
    expect(T.doseEsquecidaFamilia({ paciente: "Maria", remedio: "X", hora: "09:00" }).texto).toContain("Dose esquecida — Maria");
    const baixo = T.estoqueBaixo({ paciente: "Maria", remedio: "Losartana", dias: 3, estimativa: false });
    expect(baixo.texto).toContain("Estoque baixo — Maria");
    expect(baixo.texto).toContain("*1* — Eu cuido disso");
    expect(T.receitaVencendo({ paciente: "Maria", remedios: "Losartana", dias: 7, validade: "26/10/2026" }).texto).toContain("vence em 7 dias — Maria");
    expect(T.resumoDiario({ data: "19/10/2026", pacientes: [{ nome: "Maria", tomadas: 2, esquecidas: 1, pendentes: 0 }], estoqueCritico: [] }).texto).toContain("Maria: 2 tomadas, 1 esquecida");
  });
  it("colírio é sempre sinalizado como estimativa", () => {
    const e = T.estoque([{ paciente: "Adelino", remedio: "Colírio", dias: 5, nivel: "warning", estimativa: true }]);
    expect(e.texto).toContain("(estimativa)");
    expect(e.texto).toContain("Estimativa: colírio varia com a gota");
    expect(T.estoqueBaixo({ paciente: "A", remedio: "Colírio", dias: 2, estimativa: true }).texto).toContain("(estimativa)");
  });
  it("lista de ambiguidade é numerada e curta; nada de dado clínico além do necessário", () => {
    const r = T.qualDose([{ paciente: "Adelino", remedio: "Zypred", hora: "08:00" }, { paciente: "Maria", remedio: "Losartana", hora: "08:00" }], "tomei");
    expect(r.texto).toContain("*1* — Adelino · Zypred (08:00)");
    expect(r.texto).toContain("*2* — Maria · Losartana (08:00)");
  });
  it("número desconhecido recebe uma resposta que não revela nada", () => {
    const r = T.desconhecido().texto;
    expect(r).not.toMatch(/Adelino|Zypred|encontrad|cadastrad/i);
  });
});

describe("API: apoio", () => {
  it("separarId aceita <família>.<mensagem> e, com chave de família, só a própria", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    expect(separarId(`${a}.${b}`)).toEqual({ familyId: a, id: b });
    expect(separarId(b, a)).toEqual({ familyId: a, id: b });
    expect(separarId(`${b}.${b}`, a)).toBeNull();
    expect(separarId("lixo")).toBeNull();
    expect(separarId(`${a}.lixo`)).toBeNull();
  });
  it("JSON canônico ignora a ordem das chaves (hash da Idempotency-Key)", () => {
    expect(canonico({ b: 1, a: { d: 2, c: 3 } })).toBe(canonico({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonico({ a: 1 })).not.toBe(canonico({ a: 2 }));
  });
  it("limite de requisições: 60 por minuto por telefone, libera depois da janela", () => {
    _limparLimites();
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(limiteExcedido("tel:1", t0 + i)).toBe(0);
    expect(limiteExcedido("tel:1", t0 + 100)).toBeGreaterThan(0);
    expect(limiteExcedido("tel:2", t0 + 100)).toBe(0); // outro telefone não é afetado
    expect(limiteExcedido("tel:1", t0 + 61_000)).toBe(0);
  });
});
