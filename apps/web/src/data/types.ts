/**
 * Modelos de visão consumidos pelas telas. Tudo que chega aqui já vem calculado
 * (dias de estoque, situação da receita, rótulos): os componentes só apresentam.
 * Na Fase 3 a implementação troca de mocks para Appwrite + packages/domain
 * sem mudar este arquivo (mudança de contrato vai primeiro para os docs).
 */
import type { DoseStatus, MedRoute, PermissionMap } from "@medcuidar/shared";

export type Tone = "ok" | "pn" | "lt" | "ms" | "neu" | "br";
export type Role = "patient" | "admin" | "family" | "caregiver" | "confirmer" | "other";
export type Channel = "whatsapp" | "panel";
export type StockLevel = "critical" | "warning" | "ok";

export interface PatientVM {
  id: string;
  name: string;
  fullName: string;
  age: number;
  note: string;
  usesPhone: boolean;
  phone: string;
}

export interface PersonVM {
  id: string;
  name: string;
  relation: string;
  profileName: string;
  role: Role;
  phone: string;
  whatsappActive: boolean;
  receivesAlerts: boolean;
  permissions: PermissionMap;
}

export interface Member {
  id: string;
  name: string;
  profileName: string;
  permissions: PermissionMap;
}

export interface StockVM {
  quantity: number;
  quantityText: string;
  approximate: boolean;
  approximateNote?: string;
  daysLeft: number;
  level: StockLevel;
  runsOutLabel: string;
  /** 0..100 sobre a escala de 30 dias */
  barPct: number;
}

export type RxLinkKind = "ok" | "soon" | "awaiting" | "expired" | "none" | "otc";
export interface MedRxLinkVM {
  kind: RxLinkKind;
  text: string;
  label: string;
  icon: string;
  tone: Tone;
  alert: boolean;
  rxId?: string;
}

export interface ReplStepVM {
  n: number;
  label: string;
  kind: "done" | "cur" | "todo" | "skip";
  stateLabel: string;
  text: string;
  textTone: Tone;
}
export interface ReplLogVM {
  text: string;
  sub: string;
}
export interface ReplenishmentVM {
  step: number;
  done: boolean;
  owner?: string;
  steps: ReplStepVM[];
  stepText: string;
  ownerText: string;
  ownerTone: Tone;
  canAssume: boolean;
  assumeLabel: string;
  advanceLabel: string;
  needsAttach: boolean;
  log: ReplLogVM[];
  mine: boolean;
}

export interface PhaseVM {
  order: number;
  everyHours: number;
  fromDay: number;
  /** null = até acabar / uso contínuo */
  toDay: number | null;
  perDose: number;
}

export interface MedicationVM {
  id: string;
  patientId: string;
  name: string;
  alternatives: string[];
  route: MedRoute;
  routeLabel: string;
  unitLabel: string;
  doseText: string;
  scheduleText: string;
  phaseText: string;
  times: string[];
  perDose: number;
  phases: PhaseVM[];
  /** dia atual do tratamento (null = uso contínuo) */
  treatmentDay: number | null;
  firstTime: string;
  otc: boolean;
  stock: StockVM;
  rx: MedRxLinkVM;
  replenishment: ReplenishmentVM;
}

export interface DoseVM {
  id: string;
  medicationId: string;
  medName: string;
  patientId: string;
  patientName: string;
  time: string;
  status: DoseStatus;
  doseText: string;
  phaseText: string;
  responsible: string;
  /** "em 50 min", "Atrasada há 1 h 10", "Esquecida às 08:00" */
  whenLabel: string;
  doneBy?: string;
  doneAt?: string;
  channel?: Channel;
}

export interface RxStatusVM {
  kind: "valid" | "expired" | "awaiting_new" | "superseded";
  label: string;
  icon: string;
  tone: Tone;
  validityText: string;
  validityIcon: string;
  validityTone: Tone;
  soon: boolean;
  daysLeft?: number;
}
export interface RxViewVM {
  who: string;
  when: string;
}
export interface RxShareVM {
  to: string;
  who: string;
  at: string;
  channel: "WhatsApp" | "MedCuidar";
}
export interface RxVM {
  id: string;
  patientId: string;
  patientName: string;
  doctor: string;
  specialty: string;
  issuedOn: string;
  issuedISO: string;
  /** dias desde a emissão (para filtro por período) */
  daysSinceIssue: number;
  validityDays: number | null;
  medicationIds: string[];
  medNames: string[];
  pages: number;
  attachedBy: string;
  attachedAt: string;
  notes: string;
  controlledCopies?: number;
  status: RxStatusVM;
  previousId?: string;
  nextId?: string;
  views: RxViewVM[];
  notViewed: string[];
  cannotView: string[];
  shares: RxShareVM[];
  latestValid: boolean;
}

export type HistoryKind = "dose" | "prescription" | "replenishment";
export interface HistoryEntryVM {
  id: string;
  kind: HistoryKind;
  day: "today" | "yesterday";
  dayLabel: string;
  time: string;
  status?: DoseStatus;
  statusLabel: string;
  icon: string;
  tone: Tone;
  title: string;
  detail: string;
  patientId: string;
  medicationIds: string[];
  who: string;
  channel: string;
}

export interface InteractionVM {
  id: string;
  time: string;
  icon: string;
  tone: Tone;
  text: string;
  sub: string;
}

export interface StockMovementVM {
  id: string;
  icon: string;
  tone: Tone;
  text: string;
  sub: string;
}

export interface PermissionRowVM {
  id: string;
  label: string;
  /** valor por perfil, na ordem de `profiles` */
  values: boolean[];
}

export interface NotificationSettingsVM {
  leadDays: number;
  exceptions: { medicationId: string; days: number }[];
  receivers: Record<string, boolean>;
  reminderAtTime: boolean;
  dailySummary: boolean;
  summaryTime: string;
  repeatEveryMin: 15 | 30 | 60;
  lateAfterMin: number;
  missedAfterMin: number;
  nightTo: string;
}

export interface Snapshot {
  nowLabel: string;
  todayLabel: string;
  /** dd/mm/aaaa */
  todayDate: string;
  member: Member;
  patients: PatientVM[];
  people: PersonVM[];
  medications: MedicationVM[];
  doses: DoseVM[];
  prescriptions: RxVM[];
  history: HistoryEntryVM[];
  interactions: InteractionVM[];
  stockMovements: StockMovementVM[];
  profiles: string[];
  permissionRows: PermissionRowVM[];
  notifications: NotificationSettingsVM;
  alertCount: number;
}

export interface AttachDraft {
  patientId: string;
  date: string;
  doctor: string;
  specialty: string;
  medicationIds: string[];
  validity: "30" | "60" | "180" | "none";
  notes: string;
  pages: number;
  replacesId?: string | null;
  editId?: string | null;
}

export interface MedicationPatch {
  name?: string;
  alternatives?: string[];
  routeLabel?: string;
  perDose?: number;
}

export interface Actions {
  confirmDose(id: string): void;
  undoDose(id: string): void;
  snoozeDose(id: string, minutes: number): void;
  registerLate(id: string): void;
  assumeReplenishment(medId: string): void;
  advanceReplenishment(medId: string): void;
  saveRx(draft: AttachDraft): string;
  deleteRx(id: string): void;
  restoreRx(id: string): void;
  markSuperseded(id: string): void;
  shareRx(id: string, to: string, channel: "WhatsApp" | "MedCuidar"): void;
  registerPurchase(medId: string, qty: number): void;
  adjustStock(medId: string, qty: number, reason: string): void;
  setPermission(rowId: string, profile: string, value: boolean): void;
  setNotification(patch: Partial<NotificationSettingsVM>): void;
  updateMedication(id: string, patch: MedicationPatch): void;
  deleteMedication(id: string): void;
  restoreMedication(id: string): void;
  /** Só desenvolvimento: testa o que cada perfil enxerga. */
  viewAs(personId: string): void;
}

export interface DataSource {
  getSnapshot(): Snapshot;
  /** Prévia "passa de X para Y dias" ao registrar compra/ajuste. A regra oficial virá de packages/domain. */
  previewStockDays(medId: string, delta: number): number;
  subscribe(listener: () => void): () => void;
  actions: Actions;
}
