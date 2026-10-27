import { describe, expect, it } from "vitest";
import { intervalTimes, localNow, nextSlot, previewDay } from "./times";

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

describe("previewDay", () => {
  it("de hora em hora a partir de 22:30: 2 doses por dia e avisa que o dia é cortado", () => {
    const p = previewDay("22:30", 1, 22 * 60 + 21, true);
    expect(p.daily).toEqual(["22:30", "23:30"]);
    expect(p.todayLeft).toEqual(["22:30", "23:30"]);
    expect(p.todayPast).toEqual([]);
    expect(p.fullDay).toBe(24);
    expect(p.cutsDay).toBe(true);
  });

  it("separa as doses de hoje que já passaram e não avisa quando o dia fecha certinho", () => {
    const p = previewDay("06:00", 8, 15 * 60, true);
    expect(intervalTimes("06:00", 8)).toEqual(["06:00", "14:00", "22:00"]);
    expect(p.todayPast).toEqual(["06:00", "14:00"]);
    expect(p.todayLeft).toEqual(["22:00"]);
    expect(p.cutsDay).toBe(false);
  });

  it("tratamento que ainda não começou não tem doses hoje", () => {
    const p = previewDay("08:00", 24, 10 * 60, false);
    expect(p.todayLeft).toEqual([]);
    expect(p.todayPast).toEqual([]);
  });
});
