import { daysBetween, forecastDepletion, lowStockStatus, type Forecast, type LowStockStatus, type Treatment, type TreatmentPhase } from "@medcuidar/domain";
import type { ControlUnit, MedRoute } from "@medcuidar/shared";
import { fmtDuration } from "@/lib/format";
import type { StockLevel, StockVM } from "@/data/types";

/**
 * Contas do estoque sem acesso ao banco (testáveis sozinhas): previsão de término, nível e os textos que a tela mostra.
 * A regra de previsão e de nível é a do domínio (`forecastDepletion`, `lowStockStatus`); aqui só se monta o modelo de visão.
 */

export const DEFAULT_LOW_STOCK_DAYS = 7;
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
export const weekdayLabel = (ymd: string) => `${WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()]}, ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
export const qtyText = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

export const unitNoun = (unit: ControlUnit, route: MedRoute | string, n: number): string => {
  if (unit === "drop") return n === 1 ? "gota" : "gotas";
  if (unit === "ml") return "ml";
  if (unit === "gram") return "g";
  return route === "tablet" ? (n === 1 ? "comprimido" : "comprimidos") : n === 1 ? "unidade" : "unidades";
};

export interface StockInputs {
  /** soma dos movimentos do livro-razão */
  balance: number;
  isEstimate: boolean;
  controlUnit: ControlUnit;
  route: MedRoute | string;
  dropsPerMl: number | null;
  treatment: Treatment;
  phases: TreatmentPhase[];
  /** limite de estoque baixo, em dias (do remédio ou o padrão da família) */
  thresholdDays: number;
  now: Date;
  tz: string;
}

export interface StockCalc {
  forecast: Forecast;
  daysLeft: number;
  status: LowStockStatus;
  level: StockLevel;
  vm: StockVM;
}

export function quantityText(balance: number, unit: ControlUnit, route: string, dropsPerMl: number | null): string {
  const n = Math.max(0, Math.round(balance * 100) / 100);
  if (unit === "drop") {
    const drops = `${qtyText(n)} ${unitNoun(unit, route, n)}`;
    return dropsPerMl ? `≈ ${(n / dropsPerMl).toFixed(1).replace(".", ",")} ml · ${drops}` : drops;
  }
  if (unit === "ml") return `≈ ${qtyText(n)} ml`;
  if (unit === "gram") return `${qtyText(n)} g`;
  return `${qtyText(n)} ${unitNoun(unit, route, n)}`;
}

const todayOf = (i: Pick<StockInputs, "now" | "tz">): string => new Intl.DateTimeFormat("en-CA", { timeZone: i.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(i.now);

export function computeStock(i: StockInputs): StockCalc {
  const balance = Math.max(0, i.balance);
  const active = i.treatment.status === "active";
  const forecast = active
    ? forecastDepletion({ balance, is_estimate: i.isEstimate }, i.treatment, i.phases, i.now, i.tz)
    : ({ depletionDate: null, daysLeft: null, coversUntilEnd: true, confidence: i.isEstimate ? "low" : "high" } as Forecast);
  let daysLeft: number;
  if (forecast.daysLeft !== null) daysLeft = forecast.daysLeft;
  else if (i.treatment.end_date) daysLeft = Math.max(0, daysBetween(todayOf(i), i.treatment.end_date) + 1);
  else daysLeft = 365;
  const status = lowStockStatus(forecast.daysLeft, i.thresholdDays);
  const level: StockLevel = status === "critical" ? "critical" : status === "attention" ? "warning" : "ok";
  const runsOutLabel = forecast.depletionDate
    ? daysLeft === 0 ? `acaba hoje (${weekdayLabel(forecast.depletionDate)})` : `acaba ${weekdayLabel(forecast.depletionDate)}`
    : active ? "cobre até o fim do tratamento" : "tratamento sem doses";
  const vm: StockVM = {
    quantity: balance,
    quantityText: quantityText(balance, i.controlUnit, String(i.route), i.dropsPerMl),
    approximate: i.isEstimate,
    ...(i.isEstimate ? { approximateNote: "gotas por ml configurável; confira o frasco de vez em quando." } : {}),
    daysLeft,
    level,
    runsOutLabel,
    barPct: Math.min(100, Math.round((daysLeft / 30) * 100)),
    tracked: true,
    coversUntilEnd: forecast.coversUntilEnd,
    thresholdDays: i.thresholdDays,
  };
  return { forecast, daysLeft, status, level, vm };
}

/** Estoque ainda não registrado para o remédio (nenhuma compra nem ajuste). */
export const UNTRACKED_STOCK: StockVM = {
  quantity: 0, quantityText: "Estoque ainda não registrado", approximate: false, daysLeft: 0, level: "ok",
  runsOutLabel: "registre uma compra para acompanhar", barPct: 0, tracked: false,
};

/** "em 50 min" · "agora" · "Atrasada há 1 h 10" · "Esquecida às 08:00" · "Tomada às 08:03" · "Pulada". */
export function doseWhenLabel(status: "pending" | "taken" | "late" | "missed" | "skipped", time: string, elapsedMin: number, takenAt?: string, notToday?: boolean): string {
  switch (status) {
    case "taken": return `Tomada às ${takenAt ?? time}`;
    case "skipped": return "Pulada";
    case "missed": return notToday ? `Esquecida ontem às ${time}` : `Esquecida às ${time}`;
    case "late": return `Atrasada há ${fmtDuration(Math.max(1, Math.floor(elapsedMin)))}`;
    default: return elapsedMin < 0 ? `em ${fmtDuration(Math.max(1, Math.ceil(-elapsedMin)))}` : "agora";
  }
}
