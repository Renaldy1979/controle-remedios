import type { PermissionKey } from "@medcuidar/shared";

/** As opções de Configurações: cada uma é uma página própria (`/configuracoes/<id>`) e um item do menu em árvore. */
export const SECTIONS = [
  { id: "remedios", label: "Remédios", icon: "medication", help: "Nome, marcas, tipo de uso e dose", permission: "medications.manage" },
  { id: "esquemas", label: "Esquemas", icon: "timeline", help: "Fases, horários e duração", permission: "treatments.manage" },
  { id: "estoque", label: "Estoque", icon: "inventory_2", help: "Compras, ajustes e movimentações", permission: "stock.view" },
  { id: "pacientes", label: "Pacientes", icon: "elderly", help: "Quem toma os remédios", permission: "patients.manage" },
  { id: "pessoas", label: "Pessoas", icon: "group", help: "Convidar, perfis de acesso e desativar", permission: "members.manage" },
  { id: "perfis", label: "Perfis", icon: "admin_panel_settings", help: "O que cada perfil pode fazer", permission: "profiles.manage" },
  { id: "avisos", label: "Avisos", icon: "notifications", help: "Quando e para quem avisar", permission: "settings.manage" },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: string; help: string; permission: PermissionKey }>;

export type SectionId = (typeof SECTIONS)[number]["id"];

export const isSectionId = (v: string): v is SectionId => SECTIONS.some((s) => s.id === v);
