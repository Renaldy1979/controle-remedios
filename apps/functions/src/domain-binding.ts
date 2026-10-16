import type { AuthPort, DomainPort } from "./ports";

/**
 * PONTOS DE LIGAÇÃO COM O DOMÍNIO — a ser preenchido pelo orquestrador na Fase 3.
 * Cada método de `DomainPort` mapeia para uma função de `@medcuidar/domain`
 * (ver docs/handoffs/D-para-orquestrador-ligacao-dominio.md). Enquanto não ligado,
 * qualquer chamada falha de forma explícita em vez de agir sem regra.
 */
const notWired = (what: string) => () => {
  throw new Error(`Domínio não ligado: ${what}. Ver docs/handoffs/D-para-orquestrador-ligacao-dominio.md`);
};

export const unwiredDomain: DomainPort = {
  generateDoseEvents: notWired("generateDoseEvents"),
  resolveResponsible: notWired("resolveResponsible"),
  classifyDoseTiming: notWired("classifyDoseTiming"),
  confirmDose: notWired("confirmDose"),
  checkLowStock: notWired("checkLowStock"),
  stockOverview: notWired("stockOverview"),
  findExpiringPrescriptions: notWired("findExpiringPrescriptions"),
  claimReplenishment: notWired("claimReplenishment"),
  getPrescriptionForSharing: notWired("getPrescriptionForSharing"),
};

/** Sessão do painel via token customizado do Appwrite Auth (Users.createToken) — ligar na Fase 3. */
export const unwiredAuth: AuthPort = {
  createSessionFor: notWired("createSessionFor") as AuthPort["createSessionFor"],
};
