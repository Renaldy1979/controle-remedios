import type { ControlUnit, DoseStatus, RecipientsMode } from "@medcuidar/shared";

/** Tipos estruturais mínimos usados pelo domínio (subconjunto dos documentos do banco). */
export interface Treatment {
  id: string;
  family_id: string;
  patient_id: string;
  medication_id: string;
  start_date: string; // YYYY-MM-DD
  end_date?: string | null;
  status: "active" | "paused" | "finished";
  low_stock_days?: number | null;
}

export interface TreatmentPhase {
  id: string;
  treatment_id: string;
  order: number;
  start_day: number; // 1-based
  end_day: number | null; // null = até acabar
  schedule_type: "interval" | "fixed_times";
  interval_hours?: number | null;
  first_dose_time?: string | null; // HH:mm
  times?: string[] | null;
  dose_amount: number;
}

export interface DoseEvent {
  id: string;
  family_id: string;
  treatment_id: string;
  patient_id: string;
  medication_id: string;
  scheduled_at: string; // ISO UTC
  status: DoseStatus;
  confirmed_by_member_id?: string | null;
  confirmed_at?: string | null;
  channel?: "whatsapp" | "panel" | "system" | null;
  source_message_id?: string | null;
  amount: number;
  phase_id?: string | null;
}

export interface StockMovement {
  id?: string;
  family_id: string;
  stock_item_id: string;
  type: "purchase" | "dose" | "adjustment" | "loss";
  quantity: number; // + entra, − sai
  dose_event_id?: string | null;
  replenishment_id?: string | null;
  created_by_member_id?: string | null;
  note?: string | null;
}

export interface StockItem {
  id: string;
  family_id: string;
  patient_id: string;
  medication_id: string;
  control_unit: ControlUnit;
  is_estimate: boolean;
}

export interface Member {
  id: string;
  name: string;
  active: boolean;
  receives_family_alerts: boolean;
}

export interface CareAssignment {
  member_id: string;
  weekdays: number[]; // 0-6
  start_time: string;
  end_time: string;
  priority: number; // menor = mais prioritário
}

export type { RecipientsMode };
