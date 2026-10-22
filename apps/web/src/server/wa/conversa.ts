import "server-only";
import { and, eq, isNull, notInArray } from "drizzle-orm";
import {
  consumirConviteWhatsapp, hashCodigoVerificacao, hashConviteCodigo, verificarTelefonePendente, withFamilia,
} from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { can } from "@medcuidar/shared";
import { ForbiddenError, UserError, isUniqueViolation } from "../pg/errors";
import { confirmDose, snoozeDose } from "../pg/doses";
import { claim } from "../pg/replenishment";
import { resolveSender, type WaActor } from "./actor";
import { issueFirstAccessLink } from "./first-access";
import { findMentions, interpretText, parseCode, parseOption, type Intent } from "./interpret";
import {
  candidatasConfirmacao, horaLocal, proximasDosesHoje, visaoEstoque, type DoseAberta,
} from "./queries";
import { apagarContexto, gravarContexto, lerContexto, type ConvCtx } from "./state";
import * as T from "./texts";

/** Resposta da API de conversa: textos prontos (e opções numeradas) e a intenção reconhecida. */
export interface ConversaResultado {
  respostas: T.Resposta[];
  intent: Intent | "repetida" | "desconhecido" | "codigo_invalido" | "numero_verificado" | "convite_aceito" | "sem_permissao";
}

export interface ConversaEntrada {
  telefone: string;
  messageId: string;
  texto?: string;
  /** Atalho opcional de botão: equivale a digitar a intenção. */
  acao?: "tomei" | "lembrar" | "cuido" | "estoque" | "proximas" | "ajuda";
  now?: Date;
}

const ACAO_PARA_INTENT: Record<NonNullable<ConversaEntrada["acao"]>, Intent> = {
  tomei: "dose_tomada", lembrar: "lembrar_depois", cuido: "eu_cuido", estoque: "estoque", proximas: "proximas_doses", ajuda: "ajuda",
};

const SNOOZE_PADRAO = 15;
const MAX_OPCOES = 9;

/* ------------------------------------------------------------------ remetente ainda sem acesso */

/**
 * Quem não é um membro verificado só pode enviar um código: o de verificação do número (gerado no portal) ou o de
 * convite por WhatsApp. Qualquer outra coisa recebe a MESMA resposta genérica (não revela se o número existe).
 */
export async function remetenteDesconhecido(telefone: string, texto: string): Promise<ConversaResultado> {
  const code = parseCode(texto);
  if (!code) return { respostas: [T.desconhecido()], intent: "desconhecido" };

  // 1) código de verificação do número (o dono do número envia o código que o portal mostrou)
  const v = await verificarTelefonePendente(telefone, hashCodigoVerificacao(code));
  if (v.resultado === "verificado" && v.familiaId && v.membroId) {
    const nome = await withFamilia(v.familiaId, async (tx) => (await tx.select({ n: s.members.name }).from(s.members).where(eq(s.members.id, v.membroId!)))[0]?.n ?? "");
    await withFamilia(v.familiaId, (tx) => tx.insert(s.auditLog).values({ familyId: v.familiaId!, actorMemberId: v.membroId, action: "member.phone_verified", entity: "member", entityId: v.membroId, meta: {} }));
    return { respostas: [T.numeroVerificado({ nome })], intent: "numero_verificado" };
  }
  if (v.resultado === "bloqueado") return { respostas: [T.codigoBloqueado()], intent: "codigo_invalido" };
  if (v.resultado === "em_uso") return { respostas: [T.numeroEmUso()], intent: "codigo_invalido" };

  // 2) código de convite por WhatsApp (preso ao número esperado, uso único, 24 h)
  const c = await consumirConviteWhatsapp(telefone, hashConviteCodigo(telefone, code));
  if (c.resultado === "verificado" && c.familiaId && c.membroId) {
    const nome = await withFamilia(c.familiaId, async (tx) => (await tx.select({ n: s.members.name }).from(s.members).where(eq(s.members.id, c.membroId!)))[0]?.n ?? "");
    const link = await issueFirstAccessLink(c.familiaId, c.membroId, c.membroId, "member.whatsapp_invite_accepted");
    return { respostas: [T.conviteAceito({ nome, link: link.url })], intent: "convite_aceito" };
  }
  if (c.resultado === "bloqueado") return { respostas: [T.codigoBloqueado()], intent: "codigo_invalido" };
  if (c.resultado === "em_uso") return { respostas: [T.numeroEmUso()], intent: "codigo_invalido" };
  return { respostas: [T.codigoInvalido()], intent: "codigo_invalido" };
}

/* ------------------------------------------------------------------ remetente conhecido */

const ctxVazio = (): ConvCtx => ({ doseIds: [], medIds: [] });

async function guardarEscolha(actor: WaActor, ctx: ConvCtx, choose: NonNullable<ConvCtx["choose"]>, now: Date): Promise<void> {
  await withFamilia(actor.familyId, (tx) => gravarContexto(tx, actor.familyId, actor.memberId, { ...ctx, choose }, now));
}

async function limparEscolha(actor: WaActor, ctx: ConvCtx, now: Date, tiraDoseId?: string, tiraMedId?: string): Promise<void> {
  const next: ConvCtx = {
    doseIds: ctx.doseIds.filter((d) => d !== tiraDoseId), medIds: ctx.medIds.filter((m) => m !== tiraMedId),
  };
  await withFamilia(actor.familyId, async (tx) => {
    if (next.doseIds.length || next.medIds.length) await gravarContexto(tx, actor.familyId, actor.memberId, next, now);
    else await apagarContexto(tx, actor.memberId);
  });
}

const linha = (d: DoseAberta) => ({ paciente: d.paciente, remedio: d.remedio, hora: d.hora, dose: d.dose });

async function confirmar(actor: WaActor, ctx: ConvCtx, dose: DoseAberta, messageId: string, now: Date): Promise<T.Resposta> {
  const r = await confirmDose(actor, dose.id, now, { channel: "whatsapp", sourceMessageId: `wa:${actor.familyId}:${messageId}` });
  await limparEscolha(actor, ctx, now, dose.id);
  return r.duplicate ? T.doseJaAnotada(dose) : T.doseAnotada(linha(dose));
}

async function adiar(actor: WaActor, ctx: ConvCtx, dose: DoseAberta, now: Date): Promise<T.Resposta> {
  await snoozeDose(actor, dose.id, SNOOZE_PADRAO, now);
  await limparEscolha(actor, ctx, now, dose.id);
  return T.lembrarDeNovo({ paciente: dose.paciente, minutos: SNOOZE_PADRAO, hora: horaLocal(new Date(now.getTime() + SNOOZE_PADRAO * 60_000), actor.timezone) });
}

/** Aplica a ação a UMA dose, ou pergunta com lista numerada se houver mais de uma. Nunca adivinha. */
async function agirSobreDoses(
  actor: WaActor, ctx: ConvCtx, acao: "tomei" | "lembrar", doses: DoseAberta[], messageId: string, now: Date,
): Promise<T.Resposta> {
  if (acao === "lembrar") doses = doses.filter((d) => d.status !== "missed");
  if (doses.length === 0) return T.nenhumaDose();
  if (doses.length === 1) return acao === "tomei" ? confirmar(actor, ctx, doses[0]!, messageId, now) : adiar(actor, ctx, doses[0]!, now);
  const lista = doses.slice(0, MAX_OPCOES);
  await guardarEscolha(actor, ctx, { acao, ids: lista.map((d) => d.id) }, now);
  return T.qualDose(lista.map(linha), acao);
}

interface Reposicao { medicationId: string; paciente: string; remedio: string }

async function reposicoesAbertas(actor: WaActor): Promise<Reposicao[]> {
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ med: s.medications.id, medName: s.medications.name, patient: s.patients.name })
      .from(s.replenishments)
      .innerJoin(s.medications, eq(s.medications.id, s.replenishments.medicationId))
      .innerJoin(s.patients, eq(s.patients.id, s.replenishments.patientId))
      .where(and(notInArray(s.replenishments.status, ["done", "cancelled"]), isNull(s.medications.deletedAt), isNull(s.patients.deletedAt)));
    return rows.map((r) => ({ medicationId: r.med, paciente: T.primeiroNome(r.patient), remedio: r.medName }));
  });
}

async function assumir(actor: WaActor, ctx: ConvCtx, r: Reposicao, now: Date): Promise<T.Resposta> {
  await claim(actor, r.medicationId, {}, now);
  await limparEscolha(actor, ctx, now, undefined, r.medicationId);
  return T.reposicaoAssumida(r);
}

async function intentEuCuido(actor: WaActor, ctx: ConvCtx, now: Date): Promise<T.Resposta> {
  if (actor.access !== "active") return T.precisaPortal();
  if (!can(actor.member, "replenishment.manage")) return T.semPermissao();
  let abertas = await reposicoesAbertas(actor);
  const lembradas = abertas.filter((r) => ctx.medIds.includes(r.medicationId));
  if (lembradas.length > 0) abertas = lembradas;
  if (abertas.length === 0) return T.reposicaoNaoEncontrada();
  if (abertas.length === 1) return assumir(actor, ctx, abertas[0]!, now);
  const lista = abertas.slice(0, MAX_OPCOES);
  await guardarEscolha(actor, ctx, { acao: "cuido", ids: lista.map((r) => r.medicationId) }, now);
  return T.qualReposicao(lista);
}

async function responderEscolha(actor: WaActor, ctx: ConvCtx, n: number, messageId: string, now: Date): Promise<T.Resposta> {
  const ch = ctx.choose!;
  const id = ch.ids[n - 1];
  if (!id) return T.respostaLivre();
  if (ch.acao === "cuido") {
    if (actor.access !== "active" || !can(actor.member, "replenishment.manage")) return T.precisaPortal();
    const r = (await reposicoesAbertas(actor)).find((x) => x.medicationId === id);
    return r ? assumir(actor, ctx, r, now) : T.reposicaoNaoEncontrada();
  }
  const aberta = (await candidatasConfirmacao(actor, now)).find((d) => d.id === id);
  if (!aberta) return T.nenhumaDose();
  return ch.acao === "tomei" ? confirmar(actor, ctx, aberta, messageId, now) : adiar(actor, ctx, aberta, now);
}

async function responderOpcao(actor: WaActor, ctx: ConvCtx, n: number, messageId: string, now: Date): Promise<T.Resposta> {
  if (ctx.choose) return responderEscolha(actor, ctx, n, messageId, now);
  const abertas = ctx.doseIds.length ? (await candidatasConfirmacao(actor, now)).filter((d) => ctx.doseIds.includes(d.id)) : [];
  if (abertas.length > 0) {
    if (n === 1) return agirSobreDoses(actor, ctx, "tomei", abertas, messageId, now);
    if (n === 2) return agirSobreDoses(actor, ctx, "lembrar", abertas, messageId, now);
    return T.respostaLivre();
  }
  if (ctx.medIds.length > 0 && n === 1) return intentEuCuido(actor, ctx, now);
  // "1" sem nenhuma pergunta recente não é adivinhado
  return T.ajuda();
}

/** Doses abertas filtradas pelo que a pessoa citou (remédio/paciente), se citou algo que existe. */
async function filtrarPorMencao(actor: WaActor, texto: string, doses: DoseAberta[]): Promise<DoseAberta[]> {
  if (doses.length < 2) return doses;
  const nomes = await withFamilia(actor.familyId, async (tx) => ({
    meds: await tx.select({ id: s.medications.id, name: s.medications.name, alternativeNames: s.medications.alternativeNames }).from(s.medications),
    pats: await tx.select({ id: s.patients.id, name: s.patients.name }).from(s.patients),
  }));
  const m = findMentions(texto, nomes.pats, nomes.meds);
  let r = doses;
  if (m.medicationIds.length) r = r.filter((d) => m.medicationIds.includes(d.medicationId));
  if (m.patientIds.length) r = r.filter((d) => m.patientIds.includes(d.patientId));
  return r;
}

/** Processa a mensagem de um membro verificado. Idempotente por `messageId`. */
export async function processarMensagem(actor: WaActor, entrada: ConversaEntrada): Promise<ConversaResultado> {
  const now = entrada.now ?? new Date();
  const texto = String(entrada.texto ?? "");
  const intent: Intent = entrada.acao ? ACAO_PARA_INTENT[entrada.acao] : interpretText(texto);
  const logKey = `${actor.memberId}:${entrada.messageId}`;

  // Mesma mensagem duas vezes = uma ação só. O registro nasce antes e é desfeito se o processamento falhar.
  try {
    await withFamilia(actor.familyId, (tx) =>
      tx.insert(s.messageLog).values({
        familyId: actor.familyId, direction: "in", providerMessageId: logKey, memberId: actor.memberId, type: "text", bodyRedacted: `intent:${intent}`,
      }));
  } catch (e) {
    if (isUniqueViolation(e)) return { respostas: [T.mensagemRepetida()], intent: "repetida" };
    throw e;
  }
  try {
    return await rotear(actor, intent, texto, entrada.messageId, now);
  } catch (e) {
    await withFamilia(actor.familyId, (tx) => tx.delete(s.messageLog).where(eq(s.messageLog.providerMessageId, logKey))).catch(() => {});
    if (e instanceof ForbiddenError) return { respostas: [T.semPermissao()], intent: "sem_permissao" };
    if (e instanceof UserError) return { respostas: [{ texto: `⚠️ ${e.message}` }], intent };
    throw e;
  }
}

async function rotear(actor: WaActor, intent: Intent, texto: string, messageId: string, now: Date): Promise<ConversaResultado> {
  const ctx = await withFamilia(actor.familyId, (tx) => lerContexto(tx, actor.memberId, now));
  const ok = (r: T.Resposta, i: ConversaResultado["intent"] = intent): ConversaResultado => ({ respostas: [r], intent: i });

  switch (intent) {
    case "codigo":
      return ok({ texto: `${T.titulo("✅", "Número já verificado")}\nSeu número já está ligado ao MedCuidar.` });
    case "opcao":
      return ok(await responderOpcao(actor, ctx, parseOption(texto)!, messageId, now));
    case "dose_tomada": {
      const doses = await filtrarPorMencao(actor, texto, await candidatasConfirmacao(actor, now));
      return ok(await agirSobreDoses(actor, ctx, "tomei", doses, messageId, now));
    }
    case "lembrar_depois": {
      const todas = await candidatasConfirmacao(actor, now);
      const doses = await filtrarPorMencao(actor, texto, todas);
      return ok(await agirSobreDoses(actor, ctx, "lembrar", doses, messageId, now));
    }
    case "nao_tomou":
      return ok(T.semRegistro());
    case "eu_cuido":
      return ok(await intentEuCuido(actor, ctx, now));
    case "estoque":
      return ok(T.estoque((await visaoEstoque(actor, now)).slice(0, 10)));
    case "proximas_doses":
    case "dose_status": {
      const lista = await proximasDosesHoje(actor, now);
      return ok(T.proximasDoses(lista.map((d) => ({ ...linha(d), ...(d.situacao ? { situacao: d.situacao } : {}) }))));
    }
    case "link_acesso": {
      if (actor.access !== "whatsapp_verified") return ok(T.linkAcessoNaoPrecisa());
      const link = await issueFirstAccessLink(actor.familyId, actor.memberId, actor.memberId, "member.first_access_link_resend");
      return ok(T.linkAcesso({ link: link.url }));
    }
    case "ajuda":
      return ok(T.ajuda());
    default:
      // Texto livre fora do que o código entende: o agente de IA (Lote 4B) responde; aqui só devolvemos a intenção.
      return { respostas: [], intent: "livre" };
  }
}

/** Ponto de entrada da API: acha o remetente verificado; senão, só aceita códigos. */
export async function conversa(entrada: ConversaEntrada): Promise<ConversaResultado & { familiaId?: string }> {
  const actor = await resolveSender(entrada.telefone);
  if (!actor) return remetenteDesconhecido(entrada.telefone, String(entrada.texto ?? ""));
  return { ...(await processarMensagem(actor, entrada)), familiaId: actor.familyId };
}

export { ctxVazio };
