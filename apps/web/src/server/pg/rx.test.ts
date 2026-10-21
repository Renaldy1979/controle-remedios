// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseBrDate, sniffMime } from "./prescriptions";
import { rxInfo, rxRef, type RxRow } from "./rx-state";
import { storageError } from "./rx-storage";
import { UserError } from "./errors";

describe("receitas — contas sem banco", () => {
  it("parseBrDate só aceita dd/mm/aaaa de verdade", () => {
    expect(parseBrDate("19/10/2026")).toBe("2026-10-19");
    expect(parseBrDate(" 29/02/2028 ")).toBe("2028-02-29");
    for (const ruim of ["31/02/2026", "2026-10-19", "1/1/2026", "", "19/13/2026", "19-10-2026"]) expect(parseBrDate(ruim)).toBeNull();
  });

  it("sniffMime reconhece JPG, PNG, WEBP, HEIC e PDF pelos bytes e recusa o resto (o tipo do navegador não vale)", () => {
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]))).toBe("image/jpeg");
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffMime(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypheic"), Buffer.alloc(4)]))).toBe("image/heic");
    expect(sniffMime(Buffer.from("%PDF-1.7\n"))).toBe("application/pdf");
    for (const ruim of [Buffer.from("<html><script>"), Buffer.from("MZ\x90\x00"), Buffer.alloc(0), Buffer.from("GIF89a"), Buffer.concat([Buffer.alloc(4), Buffer.from("ftypmp42"), Buffer.alloc(4)])]) expect(sniffMime(ruim)).toBeNull();
  });

  const row = (over: Partial<RxRow> = {}): RxRow => ({ id: "r", patientId: "p", issuedOn: "2026-10-01", validUntil: "2026-10-31", status: "valid", supersededById: null, ...over });

  it("situação da receita (domínio): vigente, vence em ≤ 15 dias, vencida, sem validade, aguardando nova e substituída", () => {
    const hoje = (d: string) => rxInfo(row(), ["m"], [], d);
    expect(hoje("2026-10-10")).toMatchObject({ status: "valid", expiringSoon: false, expiresInDays: 21 });
    expect(hoje("2026-10-16")).toMatchObject({ status: "valid", expiringSoon: true, expiresInDays: 15 });
    expect(hoje("2026-10-31")).toMatchObject({ status: "valid", expiresInDays: 0 });
    expect(hoje("2026-11-01")).toMatchObject({ status: "expired", expiresInDays: -1 });
    expect(rxInfo(row({ validUntil: null }), ["m"], [], "2030-01-01")).toMatchObject({ status: "valid", noValidityInformed: true });
    expect(rxInfo(row({ supersededById: "n" }), ["m"], [], "2026-10-10").status).toBe("superseded");
    expect(rxInfo(row({ status: "superseded" }), ["m"], [], "2026-10-10").status).toBe("superseded");
    // pedido de receita em andamento para um remédio da receita (do mesmo paciente): aguardando nova
    expect(rxInfo(row(), ["m"], [{ patientId: "p", medicationId: "m" }], "2026-10-10").status).toBe("awaiting_new");
    expect(rxInfo(row(), ["m"], [{ patientId: "outro", medicationId: "m" }], "2026-10-10").status).toBe("valid");
    expect(rxRef(row(), ["m"], [], "2026-11-05")).toMatchObject({ status: "expired", medication_ids: ["m"], patient_id: "p", valid_until: "2026-10-31" });
  });

  it("falha do armazenamento vira mensagem clara (bucket ou escopo faltando, serviço fora do ar), nunca um erro cru", () => {
    for (const code of [401, 403, 404]) {
      const e = storageError({ code });
      expect(e).toBeInstanceOf(UserError);
      expect(e.message).toMatch(/ainda não foi configurado/);
    }
    expect(storageError({ code: 500 }).message).toMatch(/Não foi possível falar com o armazenamento/);
    expect(storageError(new Error("rede")).message).toMatch(/Não foi possível falar com o armazenamento/);
    const mine = new UserError("minha mensagem");
    expect(storageError(mine)).toBe(mine);
  });
});
