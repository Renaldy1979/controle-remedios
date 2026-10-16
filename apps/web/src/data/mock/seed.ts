/**
 * Dados fictícios (design.md seção 7). Hoje: quinta, 15/10/2026, 14:10.
 * Somente dados brutos; os cálculos de exibição ficam em store.ts (mock) e,
 * na Fase 3, vêm de packages/domain.
 */
import type { MedRoute } from "@medcuidar/shared";

export const NOW = new Date(2026, 9, 15, 14, 10);

export interface RawPatient {
  id: string;
  name: string;
  fullName: string;
  age: number;
  note: string;
  phone: string;
  usesPhone: boolean;
}

export const PATIENTS: RawPatient[] = [
  { id: "ad", name: "Adelino", fullName: "Adelino Souza", age: 84, note: "Usa WhatsApp e confirma sozinho as doses da manhã.", phone: "(11) 93210-9876", usesPhone: true },
  { id: "ma", name: "Maria", fullName: "Maria Souza", age: 81, note: "Tem Alzheimer e não usa celular. Quem estiver com ela confirma as doses.", phone: "Sem celular", usesPhone: false },
];

export interface RawMed {
  id: string;
  patientId: string;
  name: string;
  alternatives: string[];
  route: MedRoute;
  routeLabel: string;
  unitLabel: string;
  unit: "unit" | "ml" | "drop";
  word: string;
  perDose: number;
  doseText: string;
  scheduleText: string;
  phaseText: string;
  times: string[];
  otc?: boolean;
  approx?: boolean;
}

export const MEDS: RawMed[] = [
  { id: "zyp", patientId: "ad", name: "Zypred", alternatives: ["Facoba", "Vigadexa", "Zypred"], route: "drops", routeLabel: "Pingar", unitLabel: "Gotas", unit: "drop", word: "gotas", perDose: 1, doseText: "1 gota no olho direito", scheduleText: "De 3 em 3 horas", phaseText: "Fase 1 de 2 · dia 7 de 15", times: ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"], approx: true },
  { id: "los", patientId: "ad", name: "Losartana 50 mg", alternatives: ["Losartana genérica", "Cozaar"], route: "tablet", routeLabel: "Comprimido", unitLabel: "Unidade", unit: "unit", word: "comprimidos", perDose: 1, doseText: "1 comprimido", scheduleText: "Uma vez ao dia", phaseText: "Uso contínuo", times: ["08:00"] },
  { id: "ome", patientId: "ad", name: "Omeprazol 20 mg", alternatives: ["Omeprazol genérico", "Losec"], route: "tablet", routeLabel: "Comprimido", unitLabel: "Unidade", unit: "unit", word: "cápsulas", perDose: 1, doseText: "1 cápsula em jejum", scheduleText: "Uma vez ao dia", phaseText: "Uso contínuo", times: ["07:00"] },
  { id: "sin", patientId: "ad", name: "Sinvastatina 20 mg", alternatives: [], route: "tablet", routeLabel: "Comprimido", unitLabel: "Unidade", unit: "unit", word: "comprimidos", perDose: 1, doseText: "1 comprimido", scheduleText: "Uma vez ao dia, à noite", phaseText: "Uso contínuo", times: ["21:00"] },
  { id: "mem", patientId: "ma", name: "Memantina 10 mg", alternatives: [], route: "tablet", routeLabel: "Comprimido", unitLabel: "Unidade", unit: "unit", word: "comprimidos", perDose: 1, doseText: "1 comprimido", scheduleText: "De 12 em 12 horas", phaseText: "Uso contínuo", times: ["08:00", "20:00"] },
  { id: "met", patientId: "ma", name: "Metamucil", alternatives: [], route: "powder", routeLabel: "Pó dissolvido", unitLabel: "Unidade", unit: "unit", word: "sachês", perDose: 1, doseText: "1 sachê em 200 ml de água", scheduleText: "Uma vez ao dia", phaseText: "Fase única · até acabar", times: ["13:00"], otc: true },
  { id: "don", patientId: "ma", name: "Donepezila 10 mg", alternatives: [], route: "tablet", routeLabel: "Comprimido", unitLabel: "Unidade", unit: "unit", word: "comprimidos", perDose: 1, doseText: "1 comprimido à noite", scheduleText: "Uma vez ao dia", phaseText: "Uso contínuo", times: ["21:00"] },
  { id: "lac", patientId: "ma", name: "Lactulose", alternatives: [], route: "liquid", routeLabel: "Líquido", unitLabel: "ml", unit: "ml", word: "ml", perDose: 15, doseText: "15 ml", scheduleText: "Uma vez ao dia", phaseText: "Uso contínuo", times: ["22:00"], approx: true },
];

export const INITIAL_STOCK: Record<string, number> = { zyp: 48, los: 24, ome: 9, sin: 31, mem: 38, met: 8, don: 11, lac: 180 };

export interface RawDose {
  status: "taken" | "late" | "missed" | "skipped";
  by?: string;
  at?: string;
  channel?: "whatsapp" | "panel";
}

export const INITIAL_DOSES: Record<string, RawDose> = {
  "zyp-00:00": { status: "taken", by: "Seu João", at: "00:06", channel: "whatsapp" },
  "zyp-03:00": { status: "taken", by: "Seu João", at: "03:12", channel: "whatsapp" },
  "zyp-06:00": { status: "taken", by: "Rosa", at: "06:03", channel: "whatsapp" },
  "zyp-09:00": { status: "taken", by: "Rosa", at: "09:01", channel: "panel" },
  "zyp-12:00": { status: "taken", by: "Seu João", at: "12:04", channel: "whatsapp" },
  "ome-07:00": { status: "taken", by: "Adelino", at: "07:10", channel: "whatsapp" },
  "los-08:00": { status: "missed" },
  "mem-08:00": { status: "taken", by: "Rosa", at: "08:12", channel: "whatsapp" },
  "met-13:00": { status: "late" },
};

/** Ontem (qua, 14/10): [medicamento, horário, status, quem, quando, canal] */
export const YESTERDAY: Array<[string, string, "taken" | "late" | "missed", string, string, string]> = [
  ["zyp", "00:00", "taken", "Seu João", "00:05", "WhatsApp"], ["zyp", "03:00", "taken", "Seu João", "03:09", "WhatsApp"], ["zyp", "06:00", "taken", "Rosa", "06:05", "WhatsApp"],
  ["ome", "07:00", "taken", "Adelino", "07:02", "WhatsApp"], ["los", "08:00", "taken", "Adelino", "08:05", "WhatsApp"], ["mem", "08:00", "taken", "Rosa", "08:20", "WhatsApp"],
  ["zyp", "09:00", "taken", "Rosa", "09:02", "Painel"], ["zyp", "12:00", "taken", "Rosa", "12:10", "WhatsApp"], ["met", "13:00", "missed", "", "", ""],
  ["zyp", "15:00", "late", "Lúcia", "15:40", "WhatsApp"], ["zyp", "18:00", "taken", "Lúcia", "18:01", "WhatsApp"], ["mem", "20:00", "taken", "Lúcia", "20:05", "Painel"],
  ["zyp", "21:00", "taken", "Lúcia", "21:03", "WhatsApp"], ["sin", "21:00", "taken", "Lúcia", "21:04", "WhatsApp"], ["don", "21:00", "taken", "Lúcia", "21:04", "WhatsApp"], ["lac", "22:00", "taken", "Seu João", "22:10", "WhatsApp"],
];

export interface RawPerson {
  id: string;
  name: string;
  relation: string;
  profileName: string;
  phone: string;
  whatsappActive: boolean;
}

export const PEOPLE: RawPerson[] = [
  { id: "ana", name: "Ana", relation: "filha", profileName: "Administrador", phone: "(11) 98765-4321", whatsappActive: true },
  { id: "bia", name: "Beatriz", relation: "filha", profileName: "Familiar", phone: "(11) 99812-3344", whatsappActive: true },
  { id: "cla", name: "Cláudia", relation: "filha", profileName: "Familiar", phone: "(21) 98123-7788", whatsappActive: true },
  { id: "den", name: "Denise", relation: "filha", profileName: "Familiar", phone: "(11) 97456-1290", whatsappActive: true },
  { id: "luc", name: "Lucas", relation: "sobrinho", profileName: "Familiar", phone: "(19) 99234-5566", whatsappActive: false },
  { id: "ros", name: "Rosa", relation: "cuidadora · 6h–14h", profileName: "Cuidadora", phone: "(11) 96543-2109", whatsappActive: true },
  { id: "lui", name: "Lúcia", relation: "cuidadora · 14h–22h", profileName: "Cuidadora", phone: "(11) 95432-1098", whatsappActive: true },
  { id: "joa", name: "Seu João", relation: "sogro · noite", profileName: "Confirmador", phone: "(11) 94321-0987", whatsappActive: true },
];

export interface RawRx {
  id: string;
  patientId: string;
  doctor: string;
  specialty: string;
  /** dias relativos a hoje (negativo = passado) */
  issued: number;
  validity: number | null;
  meds: string[];
  pages: number;
  by: string;
  at: string;
  notes: string;
  waiting?: string;
  next?: string;
  prev?: string;
  copies?: number;
  views: Array<[string, string]>;
  shares: Array<{ to: string; who: string; at: string; channel: "WhatsApp" | "MedCuidar" }>;
}

export const RX: RawRx[] = [
  { id: "rx1", patientId: "ad", doctor: "Dra. Helena Prado", specialty: "Oftalmologista", issued: -20, validity: 30, meds: ["zyp"], pages: 2, by: "Ana", at: "25/09/2026 · 18:40", notes: "Esquema em 2 fases. Pode usar Facoba, Vigadexa ou Zypred, só uma delas.", prev: "rx0", views: [["Beatriz", "15/10 · 09:45"], ["Farmácia São João", "15/10 · 09:13 · WhatsApp"], ["Cláudia", "25/09 · 20:02"]], shares: [{ to: "Farmácia São João", who: "Ana", at: "15/10 · 09:12", channel: "WhatsApp" }, { to: "Beatriz e Cláudia", who: "Ana", at: "25/09 · 18:42", channel: "MedCuidar" }] },
  { id: "rx0", patientId: "ad", doctor: "Dra. Helena Prado", specialty: "Oftalmologista", issued: -82, validity: 30, meds: ["zyp"], pages: 1, by: "Beatriz", at: "25/07/2026 · 10:15", notes: "Primeira receita depois da cirurgia de catarata.", next: "rx1", views: [["Ana", "25/07 · 11:00"]], shares: [] },
  { id: "rx2", patientId: "ad", doctor: "Dr. Ricardo Lima", specialty: "Cardiologista", issued: -140, validity: 180, meds: ["los", "sin"], pages: 1, by: "Ana", at: "28/05/2026 · 15:20", notes: "Uso contínuo. Retorno em novembro.", views: [["Beatriz", "28/05 · 16:00"]], shares: [] },
  { id: "rx3", patientId: "ad", doctor: "Dra. Paula Mendes", specialty: "Clínica geral", issued: -200, validity: 180, meds: ["ome"], pages: 1, by: "Denise", at: "29/03/2026 · 09:05", notes: "", views: [], shares: [] },
  { id: "rx4", patientId: "ma", doctor: "Dr. Fernando Alves", specialty: "Neurologista", issued: -25, validity: 30, meds: ["don", "mem"], pages: 2, by: "Ana", at: "14/10/2026 · 18:05", notes: "Receita de controle especial, em 2 vias. A farmácia retém a 1ª via.", copies: 2, views: [["Cláudia", "14/10 · 19:30"]], shares: [] },
  { id: "rx5", patientId: "ma", doctor: "Dra. Paula Mendes", specialty: "Clínica geral", issued: -195, validity: 180, meds: ["lac"], pages: 1, by: "Cláudia", at: "03/04/2026 · 11:40", notes: "", waiting: "Denise pediu nova receita em 12/10", views: [], shares: [] },
];

export interface RawRepl {
  step: number;
  owner: string | null;
  since: string | null;
  log: Array<{ step: number; who: string; at: string; text: string }>;
}

export const REPL: Record<string, RawRepl> = {
  zyp: { step: 2, owner: "Beatriz", since: "15/10 · 09:40", log: [{ step: 0, who: "Ana", at: "24/09 · 16:20", text: "Pediu a receita à Dra. Helena" }, { step: 1, who: "Ana", at: "25/09 · 18:40", text: "Anexou a receita recebida" }, { step: 2, who: "Beatriz", at: "15/10 · 09:40", text: "Assumiu: vai comprar" }] },
  ome: { step: 0, owner: "Cláudia", since: "14/10 · 19:20", log: [{ step: 0, who: "Cláudia", at: "14/10 · 19:20", text: "Assumiu: vai pedir a receita" }] },
  lac: { step: 1, owner: "Denise", since: "12/10 · 16:05", log: [{ step: 0, who: "Denise", at: "12/10 · 16:05", text: "Pediu a receita à Dra. Paula" }, { step: 1, who: "Denise", at: "12/10 · 16:05", text: "Assumiu: vai buscar a receita" }] },
  don: { step: 2, owner: null, since: null, log: [{ step: 0, who: "Ana", at: "13/10 · 10:00", text: "Pediu a receita ao Dr. Fernando" }, { step: 1, who: "Ana", at: "14/10 · 18:05", text: "Anexou a receita recebida" }] },
};

export const STEPS: ReadonlyArray<readonly [label: string, verb: string]> = [
  ["Pedir receita ao médico", "vai pedir a receita"],
  ["Receita recebida", "vai buscar a receita"],
  ["Comprado", "vai comprar"],
  ["Estoque atualizado", "vai atualizar o estoque"],
];

export interface RawEvent {
  day: "today" | "yesterday";
  time: string;
  kind: "prescription" | "replenishment";
  icon: string;
  tone: "br" | "ok" | "lt";
  medIds: string[];
  patientId: string;
  who: string;
  label: string;
  detail: string;
  channel: string;
}

export const EVENTS: RawEvent[] = [
  { day: "today", time: "09:40", kind: "replenishment", icon: "front_hand", tone: "br", medIds: ["zyp"], patientId: "ad", who: "Beatriz", label: "Assumiu a reposição", detail: "Beatriz vai comprar", channel: "Painel" },
  { day: "today", time: "09:12", kind: "prescription", icon: "share", tone: "br", medIds: ["zyp"], patientId: "ad", who: "Ana", label: "Receita compartilhada", detail: "Enviada para Farmácia São João", channel: "WhatsApp" },
  { day: "yesterday", time: "19:20", kind: "replenishment", icon: "front_hand", tone: "br", medIds: ["ome"], patientId: "ad", who: "Cláudia", label: "Assumiu a reposição", detail: "Cláudia vai pedir a receita", channel: "Painel" },
  { day: "yesterday", time: "18:05", kind: "prescription", icon: "description", tone: "ok", medIds: ["don", "mem"], patientId: "ma", who: "Ana", label: "Receita anexada", detail: "Dr. Fernando Alves · 2 páginas", channel: "Painel" },
];

export const INTERACTIONS = [
  { time: "14:05", icon: "chat", tone: "br", text: "Lembrete repetido para Lúcia", sub: "Metamucil da Maria · 13:00" },
  { time: "12:04", icon: "check_circle", tone: "ok", text: 'Seu João respondeu "Tomei"', sub: "Zypred do Adelino · 12:00 · WhatsApp" },
  { time: "10:01", icon: "cancel", tone: "ms", text: "Aviso de dose esquecida enviado", sub: "Losartana do Adelino · para 5 familiares" },
  { time: "09:32", icon: "forum", tone: "br", text: 'Beatriz perguntou "como está o estoque?"', sub: "Resposta automática enviada" },
  { time: "09:00", icon: "report", tone: "ms", text: "Aviso de estoque baixo", sub: "Zypred do Adelino acaba em 6 dias" },
] as const;

export const SEED_MOVEMENTS = [
  { icon: "shopping_bag", tone: "ok", text: "Compra · Losartana 50 mg +30", sub: "01/10 · Beatriz" },
  { icon: "tune", tone: "lt", text: "Ajuste · Lactulose −20 ml", sub: "12/10 · Rosa · frasco derramou" },
  { icon: "shopping_bag", tone: "ok", text: "Compra · Zypred +1 frasco (100 gotas)", sub: "09/10 · Ana" },
] as const;
