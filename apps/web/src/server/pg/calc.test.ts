import { describe, expect, it } from "vitest";
import type { Treatment, TreatmentPhase } from "@medcuidar/domain";
import { computeStock, doseWhenLabel, quantityText } from "./calc";

const treatment: Treatment = { id: "t", family_id: "f", patient_id: "p", medication_id: "m", start_date: "2026-10-19", end_date: null, status: "active", low_stock_days: null };
const phase = (over: Partial<TreatmentPhase> = {}): TreatmentPhase => ({
  id: "ph", treatment_id: "t", order: 1, start_day: 1, end_day: null, schedule_type: "interval", interval_hours: 8, first_dose_time: "06:00", times: null, dose_amount: 1, ...over,
});
const NOON = new Date("2026-10-19T15:00:00Z"); // 12:00 em São Paulo
const base = { isEstimate: false, controlUnit: "unit" as const, route: "tablet", dropsPerMl: null, treatment, phases: [phase()], now: NOON, tz: "America/Sao_Paulo" };

describe("estoque: previsão e nível", () => {
  it("3 doses por dia: 30 comprimidos duram ~10 dias (atenção); 12 duram ~4 (crítico); 100 duram mais de 14 (ok)", () => {
    const c = (balance: number) => computeStock({ ...base, balance, thresholdDays: 7 });
    expect(c(30)).toMatchObject({ daysLeft: 10, level: "warning" });
    expect(c(12)).toMatchObject({ daysLeft: 4, level: "critical" });
    expect(c(100).level).toBe("ok");
    expect(c(0)).toMatchObject({ daysLeft: 0, level: "critical" });
    expect(c(12).vm.runsOutLabel).toMatch(/^acaba (seg|ter|qua|qui|sex|sáb|dom), \d{2}\/\d{2}$/);
  });

  it("o limite por remédio muda o nível", () => {
    expect(computeStock({ ...base, balance: 30, thresholdDays: 7 }).level).toBe("warning");
    expect(computeStock({ ...base, balance: 30, thresholdDays: 10 }).level).toBe("critical");
    expect(computeStock({ ...base, balance: 30, thresholdDays: 3 }).level).toBe("ok");
  });

  it("trocar a fase muda a previsão (8 gotas/dia acaba antes de 4 gotas/dia) e colírio é estimativa", () => {
    const slow = computeStock({ ...base, balance: 120, isEstimate: true, controlUnit: "drop", route: "drops", dropsPerMl: 20, phases: [phase({ interval_hours: 6, first_dose_time: "00:00" })], thresholdDays: 7 });
    const fast = computeStock({ ...base, balance: 120, isEstimate: true, controlUnit: "drop", route: "drops", dropsPerMl: 20, phases: [phase({ interval_hours: 3, first_dose_time: "00:00" })], thresholdDays: 7 });
    expect(slow.daysLeft).toBeGreaterThan(fast.daysLeft);
    expect(slow.vm.approximate).toBe(true);
    expect(slow.vm.approximateNote).toMatch(/gotas por ml/);
    expect(slow.forecast.confidence).toBe("low");
  });

  it("estoque que cobre até o fim do tratamento não é crítico", () => {
    const c = computeStock({ ...base, balance: 50, treatment: { ...treatment, end_date: "2026-10-22" }, thresholdDays: 7 });
    expect(c.vm.coversUntilEnd).toBe(true);
    expect(c.level).toBe("ok");
    expect(c.vm.runsOutLabel).toBe("cobre até o fim do tratamento");
  });

  it("saldo negativo (dose sem estoque registrado antes) aparece como zero", () => {
    expect(computeStock({ ...base, balance: -3, thresholdDays: 7 }).vm.quantity).toBe(0);
  });
});

describe("textos", () => {
  it("quantidade por unidade", () => {
    expect(quantityText(29, "unit", "tablet", null)).toBe("29 comprimidos");
    expect(quantityText(1, "unit", "tablet", null)).toBe("1 comprimido");
    expect(quantityText(100, "drop", "drops", 20)).toBe("≈ 5,0 ml · 100 gotas");
    expect(quantityText(100, "ml", "liquid", null)).toBe("≈ 100 ml");
    expect(quantityText(2.5, "gram", "other", null)).toBe("2,5 g");
  });

  it("rótulo da dose conforme a situação", () => {
    expect(doseWhenLabel("pending", "14:00", -50)).toBe("em 50 min");
    expect(doseWhenLabel("pending", "14:00", -70)).toBe("em 1 h 10");
    expect(doseWhenLabel("pending", "14:00", 3)).toBe("agora");
    expect(doseWhenLabel("late", "14:00", 70)).toBe("Atrasada há 1 h 10");
    expect(doseWhenLabel("missed", "08:00", 200)).toBe("Esquecida às 08:00");
    expect(doseWhenLabel("missed", "23:00", 200, undefined, true)).toBe("Esquecida ontem às 23:00");
    expect(doseWhenLabel("taken", "08:00", 5, "08:03")).toBe("Tomada às 08:03");
  });
});
