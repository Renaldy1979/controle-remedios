import { describe, expect, it } from "vitest";
import { dosesOnDate, monthGrid, type CalendarMed } from "./scheme-calendar";

const losartana: CalendarMed = {
  id: "m1", patientId: "p1", name: "Losartana", unitLabel: "Comprimido", firstTime: "08:00", startDate: "2026-10-20",
  phases: [{ order: 1, everyHours: 12, fromDay: 1, toDay: 3, perDose: 1 }, { order: 2, everyHours: 24, fromDay: 4, toDay: null, perDose: 0.5 }],
};

describe("dosesOnDate", () => {
  it("antes do dia 1 não há doses", () => {
    expect(dosesOnDate([losartana], "2026-10-19")).toEqual([]);
  });

  it("segue as fases: 12 em 12 h nos dias 1 a 3 e 1 vez ao dia depois, com a dose de cada fase", () => {
    expect(dosesOnDate([losartana], "2026-10-22").map((d) => d.time)).toEqual(["08:00", "20:00"]);
    const dia4 = dosesOnDate([losartana], "2026-10-23");
    expect(dia4.map((d) => d.time)).toEqual(["08:00"]);
    expect(dia4[0]!.doseText).toBe("0,5 × comprimido");
  });

  it("junta vários remédios ordenados por horário", () => {
    const omep: CalendarMed = { ...losartana, id: "m2", name: "Omeprazol", firstTime: "07:00", phases: [{ order: 1, everyHours: 24, fromDay: 1, toDay: null, perDose: 1 }] };
    expect(dosesOnDate([losartana, omep], "2026-10-25").map((d) => `${d.time} ${d.medName}`)).toEqual(["07:00 Omeprazol", "08:00 Losartana"]);
  });
});

describe("monthGrid", () => {
  it("outubro de 2026 começa numa quinta e fecha semanas de domingo a sábado", () => {
    const g = monthGrid(2026, 9);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![4]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(g[0]![0]!.inMonth).toBe(false);
    expect(g.flat().filter((c) => c.inMonth)).toHaveLength(31);
  });
});
