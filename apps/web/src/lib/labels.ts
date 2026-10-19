import type { ControlUnit, MedRoute } from "@medcuidar/shared";

/** Rótulos em pt-BR dos enums de remédio (usados pelas telas e pelo servidor). */
export const ROUTE_LABEL: Record<MedRoute, string> = {
  drops: "Pingar",
  tablet: "Comprimido",
  powder: "Pó dissolvido",
  liquid: "Líquido",
  ointment: "Pomada",
  other: "Outro",
};
export const UNIT_LABEL: Record<ControlUnit, string> = { drop: "Gotas", unit: "Unidade", ml: "ml", gram: "Grama" };

export const ROUTE_BY_LABEL = Object.fromEntries(Object.entries(ROUTE_LABEL).map(([k, v]) => [v, k])) as Record<string, MedRoute>;
export const UNIT_BY_LABEL = Object.fromEntries(Object.entries(UNIT_LABEL).map(([k, v]) => [v, k])) as Record<string, ControlUnit>;

export const ROUTE_LABELS = Object.values(ROUTE_LABEL);
export const UNIT_LABELS = Object.values(UNIT_LABEL);

/** Rótulo do estado de acesso de uma pessoa (docs/06 seção 2). Nunca só cor: sempre texto + ícone na tela. */
export const ACCESS_LABEL = {
  invited: "Convidado(a)",
  whatsapp_verified: "WhatsApp verificado",
  active: "Ativo(a)",
} as const;
