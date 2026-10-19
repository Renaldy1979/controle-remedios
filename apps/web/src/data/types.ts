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
  /** aaaa-mm-dd ou vazio */
  birthDate?: string;
  /** o paciente também tem conta (usuário) */
  selfMemberId?: string | null;
  selfMemberName?: string;
}

export type AccessState = "invited" | "whatsapp_verified" | "active";

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
  /** Lote 1 (origem real): estado de acesso e dados do convite */
  accessState?: AccessState;
  email?: string;
  /** número informado e ainda não validado (a validação chega no Lote 4) */
  phonePending?: string;
  active?: boolean;
  isSelf?: boolean;
  invite?: { kind: "email" | "whatsapp"; expiresLabel: string; expired: boolean };
}

export interface AccountVM {
  email: string;
  name: string;
  /** só dígitos; vazio = não informado */
  phonePending: string;
  phoneVerified: string;
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
  /** origem real: o remédio já tem estoque registrado (compra ou ajuste). Ausente = sim. */
  tracked?: boolean;
  /** origem real: o estoque cobre até o fim do tratamento */
  coversUntilEnd?: boolean;
  /** origem real: avisa quando faltarem estes dias */
  thresholdDays?: number;
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
  /** só colírio/gotas (estimativa) */
  dropsPerMl?: number;
  doseText: string;
  scheduleText: string;
  phaseText: string;
  times: string[];
  perDose: number;
  phases: PhaseVM[];
  /** dia atual do tratamento (null = uso contínuo) */
  treatmentDay: number | null;
  firstTime: string;
  /** aaaa-mm-dd: dia 1 do esquema (origem real) */
  startDate?: string;
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
  /** origem real: dia local da dose (aaaa-mm-dd); doses de ontem ainda sem resolução também aparecem */
  date?: string;
}

/** Aviso do portal (sino). Origem real. */
export interface NoticeVM {
  id: string;
  kind: string;
  title: string;
  body: string;
  whenLabel: string;
  read: boolean;
  /** para onde o aviso leva (ex.: /configuracoes/estoque?med=...) */
  href: string;
}

/** Uma linha do histórico de doses (origem real, filtrada no servidor). */
export interface DoseHistoryRowVM {
  id: string;
  /** dd/mm/aaaa */
  dateLabel: string;
  time: string;
  medName: string;
  patientId: string;
  patientName: string;
  status: DoseStatus;
  doseText: string;
  /** quem deu ("" se ninguém) */
  who: string;
  /** dd/mm às HH:mm */
  doneLabel: string;
  channel: Channel | "";
}
export interface DoseHistoryFilters {
  patientId?: string;
  medicationId?: string;
  memberId?: string;
  /** aaaa-mm-dd (dia local), inclusive */
  from?: string;
  to?: string;
  status?: DoseStatus;
}
export interface DoseHistoryResult {
  rows: DoseHistoryRowVM[];
  /** pessoas que já confirmaram doses (para o filtro) */
  people: Array<{ id: string; name: string }>;
  /** havia mais linhas do que o limite */
  truncated: boolean;
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
  /** origem real (Lote 2): avisos do sino da pessoa logada, e quantos não foram lidos */
  notices?: NoticeVM[];
  unreadNotices?: number;
  /** origem real (Lote 2): últimas doses tomadas, de qualquer dia */
  recentTaken?: DoseVM[];
  /** origem real: dados da própria conta (e-mail e WhatsApp pendente) */
  account?: AccountVM;
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
  /** celular com DDD; o servidor guarda só dígitos com 55 */
  phone: string;
  profileName: string;
  relation: string;
  /** convite: por e-mail (padrão na origem real) ou por WhatsApp */
  kind?: "email" | "whatsapp";
  email?: string;
}

/** Resultado de um convite. O código do convite por WhatsApp aparece UMA vez (o servidor guarda só o hash). */
export interface InviteResult {
  kind: "email" | "whatsapp";
  memberName: string;
  /** e-mail: o Appwrite conseguiu enviar o e-mail? */
  emailSent?: boolean;
  /** whatsapp: código de 6 dígitos, mostrado só agora */
  code?: string;
  expectedPhone?: string;
  expiresLabel: string;
}

export interface PatientInput {
  id?: string;
  name: string;
  /** aaaa-mm-dd ou vazio */
  birthDate: string;
  notes: string;
  usesPhone: boolean;
  selfMemberId: string | null;
}

export interface MedicationInput {
  patientId: string;
  name: string;
  alternatives: string[];
  routeLabel: string;
  unitLabel: string;
  dropsPerMl?: number;
  /** estoque inicial (opcional); vira uma compra de abertura */
  initialStock?: number;
}

export interface SchemeInput {
  single: boolean;
  firstTime: string;
  phases: PhaseVM[];
  /** aaaa-mm-dd: dia 1 do esquema */
  startDate?: string;
}

export interface MedicationPatch {
  name?: string;
  alternatives?: string[];
  routeLabel?: string;
  perDose?: number;
  unitLabel?: string;
  dropsPerMl?: number;
}

type Maybe<T> = T | Promise<T>;
/** `false` = falhou (o aviso de erro já foi mostrado); `void`/`true` = deu certo. */
type Done = Maybe<boolean | void>;

/** Ações podem ser síncronas (mock) ou chamar o servidor (origem real). Erros viram aviso na tela. */
export interface Actions {
  confirmDose(id: string): Done;
  undoDose(id: string): Done;
  /** Lote 2: registra o pedido; o envio do lembrete chega no Lote 4 */
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
  /** Lote 2 (origem real): marca avisos do sino como lidos (sem ids = todos) */
  markNoticesRead(ids?: string[]): Done;
  /** Lote 2 (origem real): histórico de doses filtrado no servidor */
  loadDoseHistory(filters: DoseHistoryFilters): Maybe<DoseHistoryResult | null>;
  updateMedication(id: string, patch: MedicationPatch): Done;
  saveScheme(medId: string, input: SchemeInput): Done;
  /** devolve o resultado do convite (com o código, no WhatsApp), ou null se falhou */
  inviteMember(input: MemberInput): Maybe<InviteResult | null>;
  updateMember(id: string, input: MemberInput): Done;
  /** na origem real, "remover" = desativar (derruba as sessões); é reversível */
  removeMember(id: string): Done;
  reactivateMember(id: string): Done;
  resendInvite(memberId: string): Maybe<InviteResult | null>;
  revokeInvite(memberId: string): Done;
  /** devolve o id do paciente, ou null se falhou */
  savePatient(input: PatientInput): Maybe<string | null>;
  deletePatient(id: string): Done;
  /** devolve o id do remédio, ou null se falhou */
  createMedication(input: MedicationInput): Maybe<string | null>;
  /** WhatsApp da própria conta: fica pendente (a validação real chega no Lote 4). Vazio remove. */
  saveMyPhone(phone: string): Done;
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
  readonly kind: "mock" | "postgres";
  getSnapshot(): Snapshot;
  /** Prévia "passa de X para Y dias" ao registrar compra/ajuste. A regra oficial virá de packages/domain. */
  previewStockDays(medId: string, delta: number): Maybe<number>;
  subscribe(listener: () => void): () => void;
  /** só na origem real: estado da conexão e "Tentar de novo" */
  connection?: { getStatus(): ConnectionStatus; retry(): Promise<void> };
  actions: Actions;
}
