import { addDays, daysBetween, DEFAULT_TZ, localParts } from "./time";
import { dosesPerDay, generateDoseEvents, phaseForDay } from "./doses";
import type { StockMovement, Treatment, TreatmentPhase } from "./types";

export function balance(movements: Array<Pick<StockMovement, "quantity">>): number {
  return movements.reduce((s, m) => s + m.quantity, 0);
}

export interface AdjustmentInput {
  familyId: string;
  stockItemId: string;
  newBalance: number;
  memberId: string;
  note?: string;
}

/** Ajuste manual vira movimento `adjustment` com a diferença; nunca sobrescreve o saldo. */
export function applyAdjustment(
  movements: Array<Pick<StockMovement, "quantity">>,
  input: AdjustmentInput,
): StockMovement | null {
  if (!Number.isFinite(input.newBalance) || input.newBalance < 0) throw new Error("Saldo ajustado inválido");
  const delta = Math.round((input.newBalance - balance(movements)) * 1000) / 1000;
  if (delta === 0) return null;
  return {
    family_id: input.familyId,
    stock_item_id: input.stockItemId,
    type: "adjustment",
    quantity: delta,
    created_by_member_id: input.memberId,
    note: input.note ?? null,
  };
}

export interface Forecast {
  /** Data (YYYY-MM-DD) em que o estoque não cobre mais uma dose; null se cobre até o fim do tratamento. */
  depletionDate: string | null;
  /** Dias inteiros cobertos a partir de `from` (inclui hoje); null se cobre até o fim. */
  daysLeft: number | null;
  coversUntilEnd: boolean;
  confidence: "high" | "low";
}

const MAX_DAYS = 3650;

/**
 * Previsão de término: percorre dia a dia, aplicando o consumo da fase de cada dia
 * (por isso atravessa mudanças de fase e a fase "até acabar").
 */
export function forecastDepletion(
  stockItem: { balance: number; is_estimate: boolean },
  treatment: Treatment,
  phases: TreatmentPhase[],
  from: Date | string,
  tz: string = DEFAULT_TZ,
): Forecast {
  const confidence = stockItem.is_estimate ? "low" : "high";
  const start = typeof from === "string" ? from : localParts(from, tz).date;
  const covered = (): Forecast => ({ depletionDate: null, daysLeft: null, coversUntilEnd: true, confidence });
  const sorted = [...phases].sort((a, b) => a.order - b.order);
  const last = sorted[sorted.length - 1];
  if (!last) return covered();

  let remaining = stockItem.balance;
  let days = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    const date = addDays(start, i);
    if (treatment.end_date && date > treatment.end_date) return covered();
    const day = daysBetween(treatment.start_date, date) + 1;
    if (last.end_day !== null && day > last.end_day) return covered();
    const phase = day >= 1 ? phaseForDay(sorted, day) : undefined;
    const fullNeed = phase ? dosesPerDay(phase) * phase.dose_amount : 0;
    let need = fullNeed;
    if (fullNeed > 0 && i === 0 && typeof from !== "string") {
      // hoje: o saldo já descontou o que foi tomado; conta só as doses que ainda faltam
      const fromMs = from.getTime();
      need = generateDoseEvents({ ...treatment, status: "active" }, sorted, date, tz)
        .filter((d) => Date.parse(d.scheduled_at) >= fromMs)
        .reduce((a, d) => a + d.amount, 0);
      if (need === 0) {
        days++;
        continue;
      }
    }
    if (need === 0) {
      if (phase && phase.end_day === null) return covered();
      days++;
      continue;
    }
    if (remaining + 1e-9 < need) return { depletionDate: date, daysLeft: days, coversUntilEnd: false, confidence };
    remaining -= need;
    days++;
  }
  return covered();
}

export type LowStockStatus = "ok" | "attention" | "critical";

/** Com limite 7: ≤7 crítico, 8–14 atenção, >14 ok (a faixa de atenção é o dobro do limite). */
export function lowStockStatus(daysLeft: number | null, thresholdDays = 7): LowStockStatus {
  if (daysLeft === null) return "ok";
  if (daysLeft <= thresholdDays) return "critical";
  if (daysLeft <= thresholdDays * 2) return "attention";
  return "ok";
}
