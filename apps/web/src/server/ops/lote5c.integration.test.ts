// @vitest-environment node
/**
 * Lote 5C: estado do backup informado pelo serviço de backup e alertas aos administradores. Papel da APLICAÇÃO.
 * Sem o banco no ar a suíte é PULADA (REQUIRE_DB=1 falha).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bancoDisponivel, conectarAdmin, encerrar, limparFamilias, limparFamiliasAntigasDeTeste, prepararBanco, type Admin } from "@medcuidar/pg-testing";
import { createFamilyWithAdmin } from "../pg/families";
import { HORAS_ATE_ATRASAR, conferirBackup, lerRelatorio, registrarRelatorioBackup, segredoDoRelatorioConfere, situacaoDoBackup } from "./backup-status";

const up = await bancoDisponivel();
if (!up) console.warn("[web] Postgres local indisponível: testes do Lote 5C PULADOS. Rode `pnpm db:up`.");

describe("Lote 5C — relatório do backup (puro)", () => {
  const agora = new Date("2026-11-03T12:00:00Z");

  it("segredo: só confere com 16+ caracteres iguais", () => {
    expect(segredoDoRelatorioConfere("x".repeat(16), "x".repeat(16))).toBe(true);
    expect(segredoDoRelatorioConfere("outro".repeat(5), "x".repeat(16))).toBe(false);
    expect(segredoDoRelatorioConfere("curto", "curto")).toBe(false); // segredo fraco nunca confere
    expect(segredoDoRelatorioConfere("", "")).toBe(false);
  });

  it("corpo: exige ok booleano, data plausível e ignora o resto", () => {
    expect(lerRelatorio({ ok: true, at: agora.toISOString(), bytes: 1234 }, agora)).toMatchObject({ ok: true, bytes: 1234 });
    expect(lerRelatorio({ ok: false }, agora)).toMatchObject({ ok: false, bytes: null });
    expect(lerRelatorio({ ok: "sim" }, agora)).toBeNull();
    expect(lerRelatorio(null, agora)).toBeNull();
    expect(lerRelatorio({ ok: true, at: "2020-01-01T00:00:00Z" }, agora)).toBeNull(); // data velha demais
    expect(lerRelatorio({ ok: true, at: "lixo" }, agora)).toBeNull();
    expect(lerRelatorio({ ok: true, bytes: -5 }, agora)).toMatchObject({ bytes: null });
  });

  it("situação: ok, falhou, atrasado e sem registro", () => {
    const h = (n: number) => new Date(agora.getTime() - n * 3600_000).toISOString();
    expect(situacaoDoBackup(null, agora)).toBe("sem_registro");
    expect(situacaoDoBackup({ ultimaEm: h(2), ultimaOk: true, ultimoSucessoEm: h(2), bytes: 1, atrasoAvisadoDe: null }, agora)).toBe("ok");
    expect(situacaoDoBackup({ ultimaEm: h(1), ultimaOk: false, ultimoSucessoEm: h(25), bytes: 1, atrasoAvisadoDe: null }, agora)).toBe("falhou");
    expect(situacaoDoBackup({ ultimaEm: h(1), ultimaOk: true, ultimoSucessoEm: h(HORAS_ATE_ATRASAR + 1), bytes: 1, atrasoAvisadoDe: null }, agora)).toBe("atrasado");
    expect(situacaoDoBackup({ ultimaEm: h(1), ultimaOk: false, ultimoSucessoEm: null, bytes: null, atrasoAvisadoDe: null }, agora)).toBe("atrasado");
  });
});

describe.skipIf(!up)("Lote 5C — alertas do backup aos administradores", () => {
  let admin: Admin;
  const criadas: string[] = [];
  let familyId = "";
  let memberId = "";

  beforeAll(async () => {
    admin = conectarAdmin();
    await prepararBanco();
    await limparFamiliasAntigasDeTeste(admin);
    const r = await createFamilyWithAdmin({ appwriteUserId: `zz-test-${randomUUID()}`, name: "Admin 5C", email: `zz-test-5c-${randomUUID().slice(0, 6)}@exemplo.test`, familyName: `Família 5C ${randomUUID().slice(0, 4)}` });
    familyId = r.familyId;
    memberId = r.memberId;
    criadas.push(familyId);
  });
  afterAll(async () => {
    await admin`delete from whatsapp_runtime where key = 'backup'`;
    await limparFamilias(admin, criadas);
    await encerrar(admin);
  });

  const avisos = async (alerta: string) =>
    admin`select * from notifications where family_id = ${familyId} and member_id = ${memberId} and payload->>'alerta' = ${alerta}`;

  it("falha informada avisa o administrador; sucesso depois não repete nem apaga o histórico", async () => {
    const t0 = new Date("2026-11-03T06:00:00Z");
    await registrarRelatorioBackup({ ok: true, em: t0, bytes: 1000 }, t0);
    expect(await avisos("backup_falhou")).toHaveLength(0);
    const t1 = new Date("2026-11-04T06:00:00Z");
    const estado = await registrarRelatorioBackup({ ok: false, em: t1, bytes: null }, t1);
    expect(estado).toMatchObject({ ultimaOk: false, ultimoSucessoEm: t0.toISOString(), bytes: 1000 });
    expect(await avisos("backup_falhou")).toHaveLength(1);
    await registrarRelatorioBackup({ ok: false, em: t1, bytes: null }, t1); // mesma rodada reenviada: um aviso só
    expect(await avisos("backup_falhou")).toHaveLength(1);
    const t2 = new Date("2026-11-05T06:00:00Z");
    expect(await registrarRelatorioBackup({ ok: true, em: t2, bytes: 1100 }, t2)).toMatchObject({ ultimaOk: true, ultimoSucessoEm: t2.toISOString() });
  });

  it("serviço sumido (sem sucesso há mais de 30 h) avisa uma vez só; ao voltar e sumir de novo, avisa de novo", async () => {
    const ok = new Date("2026-11-06T06:00:00Z");
    await registrarRelatorioBackup({ ok: true, em: ok, bytes: 1 }, ok);
    expect(await conferirBackup(new Date(ok.getTime() + 20 * 3600_000))).toBe("ok");
    expect(await avisos("backup_atrasado")).toHaveLength(0);
    const tarde = new Date(ok.getTime() + 31 * 3600_000);
    expect(await conferirBackup(tarde)).toBe("atrasado");
    expect(await conferirBackup(new Date(tarde.getTime() + 3600_000))).toBe("atrasado");
    expect(await avisos("backup_atrasado")).toHaveLength(1);
    const volta = new Date(ok.getTime() + 48 * 3600_000);
    await registrarRelatorioBackup({ ok: true, em: volta, bytes: 1 }, volta);
    await conferirBackup(new Date(volta.getTime() + 40 * 3600_000));
    expect(await avisos("backup_atrasado")).toHaveLength(2);
  });

  it("sem nenhum relatório (backup nunca configurado para avisar) não alerta", async () => {
    await admin`delete from whatsapp_runtime where key = 'backup'`;
    const antes = (await avisos("backup_atrasado")).length;
    expect(await conferirBackup(new Date("2027-01-01T00:00:00Z"))).toBe("sem_registro");
    expect(await avisos("backup_atrasado")).toHaveLength(antes);
  });
});
