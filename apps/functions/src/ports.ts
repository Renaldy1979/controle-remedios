/**
 * Portas finas: tudo que `apps/functions` precisa de fora (dados, domínio, relógio, alertas).
 * A regra de negócio vive em `@medcuidar/domain`; aqui só se declara o que se espera dela.
 * A ligação real é feita no runtime (ver docs/handoffs/D-para-orquestrador-ligacao-dominio.md).
 */
import type { FamilySettings } from "@medcuidar/shared";

// ───────────────────────── dados ─────────────────────────

export type Scalar = string | number | boolean;
export type Cond =
  | Scalar
  | { in: Scalar[] }
  | { ne?: Scalar; lt?: Scalar; lte?: Scalar; gt?: Scalar; gte?: Scalar };
export type Where = Record<string, Cond>;

export interface FindOptions {
  limit?: number;
  orderBy?: string;
  order?: "asc" | "desc";
}

export type Row = { $id: string; $createdAt?: string } & Record<string, unknown>;

/** Acesso a dados preso a UMA família (implementação real: FamilyScopedDb). */
export interface FamilyData {
  readonly familyId: string;
  create(collection: string, data: Record<string, unknown>, id?: string): Promise<Row>;
  get(collection: string, id: string): Promise<Row>;
  getOrNull(collection: string, id: string): Promise<Row | null>;
  find(collection: string, where?: Where, options?: FindOptions): Promise<Row[]>;
  update(collection: string, id: string, data: Record<string, unknown>): Promise<Row>;
}

export interface FamilyInfo {
  id: string;
  name: string;
  timezone: string;
  settings: FamilySettings;
}

/** Coleções globais (`families`, `login_codes`): não passam por FamilyScopedDb. */
export interface GlobalData {
  listFamilies(): Promise<FamilyInfo[]>;
  createLoginCode(data: { phone_e164: string; code_hash: string; expires_at: string; attempts: number }): Promise<Row>;
  findLoginCodes(phone: string): Promise<Row[]>;
  updateLoginCode(id: string, data: Record<string, unknown>): Promise<Row>;
}

export type DataFactory = (familyId: string) => FamilyData;

// ───────────────────────── domínio ─────────────────────────

export type DoseStatus = "pending" | "taken" | "late" | "missed" | "skipped";

export interface ConfirmDoseInput {
  familyId: string;
  doseEventId: string;
  memberId: string;
  channel: "whatsapp";
  /** Id da mensagem do provedor. O domínio DEVE ser idempotente por este valor. */
  sourceMessageId: string;
}
export interface ConfirmDoseResult {
  outcome: "confirmed" | "already_confirmed" | "already_taken" | "not_found" | "forbidden";
  patientId?: string;
  medicationId?: string;
}

export interface LowStockAlert {
  replenishmentId: string;
  patientId: string;
  patientName: string;
  medicationId: string;
  medicationName: string;
  daysLeft: number;
  level: "attention" | "critical";
  isEstimate: boolean;
}

export interface StockOverviewLine {
  patientId: string;
  patientName: string;
  medicationId: string;
  medicationName: string;
  daysLeft: number;
  level: "ok" | "attention" | "critical";
  isEstimate: boolean;
}

export interface ExpiringPrescription {
  prescriptionId: string;
  patientId: string;
  patientName: string;
  medications: string[];
  /** YYYY-MM-DD */
  validUntil: string;
  daysLeft: number;
}

export type ClaimResult =
  | { outcome: "claimed"; patientName: string; medicationName: string; ownerName: string; alreadyOwner: boolean }
  | { outcome: "taken_by_other"; patientName: string; medicationName: string; ownerName: string }
  | { outcome: "not_found" };

export interface SharablePrescription {
  prescriptionId: string;
  patientName: string;
  doctorName?: string;
  specialty?: string;
  /** YYYY-MM-DD */
  validUntil?: string;
  medications: string[];
  /** URL assinada de curta duração. */
  imageUrl: string;
  mimeType: string;
}

export interface DomainPort {
  /** Gera (idempotente) os dose_events do dia local `date` (YYYY-MM-DD) da família. */
  generateDoseEvents(input: { familyId: string; date: string }): Promise<{ created: number }>;
  /** Membros que devem receber o lembrete (já aplica escala, modo de destinatários e queda para a família). */
  resolveResponsible(input: { familyId: string; patientId: string; at: Date }): Promise<string[]>;
  /** pending → late → missed conforme o tempo (limites vêm das configurações da família). */
  classifyDoseTiming(input: {
    status: DoseStatus;
    scheduledAt: Date;
    now: Date;
    lateAfterMin: number;
    missedAfterMin: number;
  }): "pending" | "late" | "missed";
  confirmDose(input: ConfirmDoseInput): Promise<ConfirmDoseResult>;
  /** Avalia previsão de término; cria/atualiza reposições e devolve o que está em atenção/crítico. */
  checkLowStock(input: { familyId: string; patientId?: string; medicationId?: string }): Promise<LowStockAlert[]>;
  stockOverview(input: { familyId: string; patientId?: string }): Promise<StockOverviewLine[]>;
  findExpiringPrescriptions(input: { familyId: string; today: string }): Promise<ExpiringPrescription[]>;
  claimReplenishment(input: { familyId: string; replenishmentId: string; memberId: string }): Promise<ClaimResult>;
  /** Devolve a receita a mostrar (vigente mais recente do remédio da reposição, ou a indicada). Verifica permissão. */
  getPrescriptionForSharing(input: {
    familyId: string;
    memberId: string;
    replenishmentId?: string;
    prescriptionId?: string;
  }): Promise<SharablePrescription | null>;
}

// ───────────────────────── transcrição, relógio, monitoramento ─────────────────────────

export interface TranscriptionPort {
  transcribe(input: { audio: Uint8Array; mimeType: string; language: string }): Promise<{ text: string }>;
}

export interface Clock {
  now(): Date;
}

export interface AlertEvent {
  kind: "outbox_dead" | "provider_down" | "scheduler_error" | "scheduler_stalled" | "inbound_error";
  /** Somente ids e contagens. Nunca telefone, nome ou texto de mensagem. */
  details: Record<string, string | number | boolean>;
}

export interface Monitor {
  heartbeat(name: string, info: Record<string, string | number | boolean>): Promise<void>;
  alert(event: AlertEvent): Promise<void>;
}

export interface RateLimiter {
  /** true se pode seguir; false se estourou o limite. */
  allow(key: string, now: Date): boolean;
}

export interface AuthPort {
  /** Abre sessão do Appwrite Auth para o telefone já validado (token customizado). */
  createSessionFor(phoneE164: string): Promise<{ token: string } | null>;
}

export type LogFields = Record<string, string | number | boolean | null | undefined>;
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}
