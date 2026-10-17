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
  /** etapa "Comprado": pede a quantidade comprada antes de concluir */
  needsQuantity: boolean;
  suggestedQuantity?: number;
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
  /** URLs assinadas de curta duração (só na origem real); sem elas a miniatura é o papel desenhado */
  pageUrls?: Array<{ thumb: string; full: string; mime: string }>;
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
  family: { name: string; canSwitch: boolean };
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
  /** controle especial (número de vias) */
  controlled?: boolean;
  copies?: number;
  /** arquivos das páginas (só na origem real; o upload usa estes arquivos) */
  files?: File[];
  replacesId?: string | null;
  editId?: string | null;
}

export interface ShareTarget {
  /** pessoas do sistema (família) */
  memberIds?: string[];
  /** número externo (farmácia, grupo, outro) */
  phone?: string;
  label: string;
  message?: string;
}

export interface MemberInput {
  name: string;
  /** telefone com DDD; o servidor normaliza para E.164 */
  phone: string;
  profileName: string;
  relation: string;
}

export interface SchemeInput {
  single: boolean;
  firstTime: string;
  phases: PhaseVM[];
}

export interface MedicationPatch {
  name?: string;
  alternatives?: string[];
  routeLabel?: string;
  perDose?: number;
}

type Maybe<T> = T | Promise<T>;
/** `false` = falhou (o aviso de erro já foi mostrado); `void`/`true` = deu certo. */
type Done = Maybe<boolean | void>;

/** Ações podem ser síncronas (mock) ou chamar o servidor (origem real). Erros viram aviso na tela. */
export interface Actions {
  confirmDose(id: string): Done;
  undoDose(id: string): Done;
  snoozeDose(id: string, minutes: number): Done;
  registerLate(id: string): Done;
  assumeReplenishment(medId: string): Done;
  advanceReplenishment(medId: string, opts?: { quantity?: number }): Done;
  /** devolve o id da receita, ou null se falhou */
  saveRx(draft: AttachDraft): Maybe<string | null>;
  deleteRx(id: string): Done;
  restoreRx(id: string): Done;
  markSuperseded(id: string): Done;
  recordRxView(id: string): Done;
  shareRx(id: string, target: ShareTarget, channel: "WhatsApp" | "MedCuidar"): Done;
  registerPurchase(medId: string, qty: number): Done;
  /** newBalance = quanto tem agora (o ajuste vira movimento com a diferença) */
  adjustStock(medId: string, newBalance: number, reason: string): Done;
  setPermission(rowId: string, profile: string, value: boolean): Done;
  setNotification(patch: Partial<NotificationSettingsVM>): Done;
  updateMedication(id: string, patch: MedicationPatch): Done;
  saveScheme(medId: string, input: SchemeInput): Done;
  inviteMember(input: MemberInput): Done;
  updateMember(id: string, input: MemberInput): Done;
  removeMember(id: string): Done;
  deleteMedication(id: string): Done;
  restoreMedication(id: string): Done;
  /** Só desenvolvimento (origem mock): testa o que cada perfil enxerga. */
  viewAs(personId: string): Done;
}

export interface ConnectionStatus {
  /** o último contato com o servidor falhou: as telas mostram os dados em cache */
  offline: boolean;
  /** hora (HH:mm) dos dados que estão na tela */
  dataAsOf: string;
}

export interface DataSource {
  /** de onde vêm os dados: define o que a interface mostra (ex.: "Ver como" só no mock) */
  readonly kind: "mock" | "appwrite";
  getSnapshot(): Snapshot;
  /** Prévia "passa de X para Y dias" ao registrar compra/ajuste. A regra oficial virá de packages/domain. */
  previewStockDays(medId: string, delta: number): Maybe<number>;
  subscribe(listener: () => void): () => void;
  /** só na origem real: estado da conexão e "Tentar de novo" */
  connection?: { getStatus(): ConnectionStatus; retry(): Promise<void> };
  actions: Actions;
}
