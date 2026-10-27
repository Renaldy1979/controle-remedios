import { describe, expect, it } from "vitest";
import { addDaysIso, localNow, nextSlot } from "./times";

// 26/10/2026 22:21 em São Paulo (UTC-3) = 01:21 UTC do dia 27
const AT_2221 = new Date("2026-10-27T01:21:00Z");

describe("nextSlot", () => {
  it("22:21 sugere 22:30; 22:30 sugere 23:00; 23:45 vira 00:00 de amanhã", () => {
    expect(nextSlot(AT_2221)).toEqual({ time: "22:30", tomorrow: false });
    expect(nextSlot(new Date("2026-10-27T01:30:00Z"))).toEqual({ time: "23:00", tomorrow: false });
    expect(nextSlot(new Date("2026-10-27T02:45:00Z"))).toEqual({ time: "00:00", tomorrow: true });
  });

  it("usa o fuso de São Paulo, não o do computador", () => {
    expect(localNow(AT_2221)).toEqual({ date: "2026-10-26", minutes: 22 * 60 + 21 });
  });
});

describe("addDaysIso", () => {
  it("soma dias atravessando mês e ano", () => {
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });
});
