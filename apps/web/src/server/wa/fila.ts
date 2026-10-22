import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { listarFamiliasAtivas, withFamilia, type Tx } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { effectiveRecipientsMode, localParts, resolveResponsible } from "@medcuidar/domain";
import { can, familySettingsSchema, permissionMapSchema, type FamilySettings } from "@medcuidar/shared";
import { prepareDay } from "../pg/prepare";
import { DEFAULT_LOW_STOCK_DAYS } from "../pg/calc";
import { effectivePermissions } from "./actor";
import { dosesAbertas, estoqueDaFamilia, resumoDoDia } from "./queries";
import { lembrarNoContexto } from "./state";
import * as T from "./texts";

/**
 * Fila de saída do WhatsApp (docs/10). Duas etapas, ambas idempotentes:
 *  1) GERAR: transforma o que aconteceu (dose na hora, esquecida, estoque baixo, receita, resumo) em linhas de
 *     `outbound_messages`, uma por pessoa com número VERIFICADO, com `dedupe_key` único.
 *  2) REIVINDICAR: entrega ao worker o que enviar AGORA, com lease (`claimed_until`) via FOR UPDATE SKIP LOCKED;
 *     o worker marca como enviada ANTES de mandar (nunca duplica) e desfaz só se o provedor recusar com clareza.
 *     Sem confirmação, o lease vence e a mensagem volta (no máximo 5 vezes). Falha definitiva vira erro visível (`failed_at`).
 * Quem não tem número verificado não gera linha: vê o aviso no portal (sino).
 */

const LEASE_MS = 2 * 60_000;
const MAX_ENTREGAS = 5;
const JANELA_RESUMO_MS = 3 * 3600_000;

export interface MensagemPendente {
  /** Opaco: `<familyId>.<messageId>`. Use como está em POST /lembretes/{id}/enviado. */
  id: string;
  familiaId: string;
  membroId: string;
  /** Número verificado do destinatário (só dígitos), como cadastrado. */
  telefone: string;
  /** Forma (com/sem o 9) que o WhatsApp aceitou por último; nulo = ainda não se sabe. */
  numeroEnvio: string | null;
  tipo: string;
  texto: string;
  opcoes: Array<{ numero: number; rotulo: string }>;
  /** Mesma mensagem nunca sai duas vezes: chave estável de dedupe. */
  dedupe: string;
  quando: string;
}

interface Destinatario {
  id: string;
  name: string;
  phone: string;
  access: "whatsapp_verified" | "active";
  receivesFamilyAlerts: boolean;
  profileName: string;
  can: (k: Parameters<typeof can>[1]) => boolean;
}

/** Pessoas elegíveis ao WhatsApp: ativas, número VERIFICADO e acesso `whatsapp_verified` ou `active`. */
async function destinatarios(tx: Tx): Promise<Destinatario[]> {
  const rows = await tx
    .select({ m: s.members, profileName: s.profiles.name, permissions: s.profiles.permissions })
    .from(s.members)
    .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
    .where(and(eq(s.members.active, true), isNull(s.members.removedAt)));
  const out: Destinatario[] = [];
  for (const r of rows) {
    if (!r.m.phoneVerified || r.m.whatsappOptOutAt || (r.m.accessState !== "whatsapp_verified" && r.m.accessState !== "active")) continue;
    const parsed = permissionMapSchema.safeParse(r.permissions);
    const eff = effectivePermissions(r.m.accessState, r.profileName, parsed.success ? parsed.data : {});
    out.push({
      id: r.m.id, name: r.m.name, phone: r.m.phoneVerified, access: r.m.accessState, receivesFamilyAlerts: r.m.receivesFamilyAlerts,
      profileName: r.profileName, can: (k) => can(eff, k),
    });
  }
  return out;
}

type Novo = typeof s.outboundMessages.$inferInsert;

async function inserir(tx: Tx, rows: Novo[]): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await tx.insert(s.outboundMessages).values(rows).onConflictDoNothing({ target: [s.outboundMessages.familyId, s.outboundMessages.dedupeKey] }).returning({ id: s.outboundMessages.id });
  return r.length;
}

const opcoesDe = (r: T.Resposta) => (r.opcoes ?? []).map((o) => o.rotulo);

/** Quando cada família foi "gerada" pela última vez (por processo): leituras sem lease (simulador) não repetem o trabalho a cada clique. */
const ultimaGeracao = new Map<string, number>();
const REUSO_LEITURA_MS = 5_000;
export const _limparGeracao = () => ultimaGeracao.clear();

/**
 * Cria as mensagens que já deveriam existir (idempotente). `agora` injetável para teste.
 * Devolve quantas linhas NOVAS entraram na fila.
 */
export async function gerarMensagens(familyId: string, agora: Date = new Date()): Promise<number> {
  ultimaGeracao.set(familyId, Date.now());
  const fam = await withFamilia(familyId, async (tx) => (await tx.select().from(s.families).where(eq(s.families.id, familyId)))[0]);
  if (!fam || !fam.active || fam.deletedAt) return 0;
  const settings = familySettingsSchema.parse(fam.settings ?? {});
  const tz = fam.timezone;
  await prepareDay({ familyId, timezone: tz, settings }, agora);

  return withFamilia(familyId, async (tx) => {
    const dest = await destinatarios(tx);
    if (dest.length === 0) return 0;
    let novas = 0;
    novas += await gerarDoses(tx, familyId, tz, settings, dest, agora);
    novas += await gerarAvisos(tx, familyId, dest, agora);
    novas += await gerarResumo(tx, familyId, tz, settings, dest, agora);
    return novas;
  });
}

async function gerarDoses(tx: Tx, familyId: string, tz: string, settings: FamilySettings, dest: Destinatario[], agora: Date): Promise<number> {
  const janela = { de: new Date(agora.getTime() - 24 * 3600_000), ate: agora };
  const doses = await dosesAbertas(tx, tz, settings, agora, janela);
  if (doses.length === 0) return 0;
  const [pacientes, assignments, doseRows] = await Promise.all([
    tx.select().from(s.patients),
    tx.select().from(s.careAssignments),
    tx.select({ id: s.doseEvents.id, remindAgainAt: s.doseEvents.remindAgainAt }).from(s.doseEvents).where(inArray(s.doseEvents.id, doses.map((d) => d.id))),
  ]);
  const again = new Map(doseRows.map((d) => [d.id, d.remindAgainAt]));
  const domainMembers = dest.map((d) => ({ id: d.id, name: d.name, active: true, receives_family_alerts: d.receivesFamilyAlerts }));
  const rows: Novo[] = [];
  const reagendadas: string[] = [];

  for (const d of doses) {
    const paciente = pacientes.find((p) => p.id === d.patientId);
    const modo = effectiveRecipientsMode({ reminder_recipients_mode: paciente?.reminderRecipientsMode ?? null }, settings);
    const quem = resolveResponsible({
      assignments: assignments.filter((a) => a.patientId === d.patientId).map((a) => ({ member_id: a.memberId, weekdays: a.weekdays, start_time: a.startTime, end_time: a.endTime, priority: a.priority })),
      members: domainMembers, mode: modo, datetime: d.scheduledAt, tz,
    });
    const confirmam = quem.recipients.map((m) => dest.find((x) => x.id === m.id)!).filter((x) => x && x.can("doses.confirm"));
    const base = { dose: d.dose, paciente: d.paciente, remedio: d.remedio, hora: d.hora };

    if (d.status === "missed") {
      // dose esquecida: avisa a família (quem recebe alertas da família; se ninguém marcou, todos os verificados)
      const familia = dest.filter((x) => x.receivesFamilyAlerts && x.can("dashboard.view"));
      const alvo = familia.length ? familia : dest.filter((x) => x.can("dashboard.view"));
      const r = T.doseEsquecidaFamilia(base);
      for (const m of alvo) {
        rows.push({ familyId, memberId: m.id, kind: "dose_missed", dedupeKey: `dose:${d.id}:missed:${m.id}`, body: r.texto, options: opcoesDe(r), context: { doseId: d.id }, notBefore: agora });
      }
      continue;
    }

    const r = T.lembreteDose({ ...base, atrasada: d.status === "late" });
    for (const m of confirmam) {
      rows.push({ familyId, memberId: m.id, kind: "dose_reminder", dedupeKey: `dose:${d.id}:remind:${m.id}`, body: r.texto, options: opcoesDe(r), context: { doseId: d.id }, notBefore: d.scheduledAt });
    }
    // "lembrar de novo": pedido registrado no portal ou pelo WhatsApp
    const ra = again.get(d.id);
    if (ra && ra <= agora) {
      const r2 = T.lembreteDose({ ...base, atrasada: d.status === "late" });
      for (const m of confirmam) {
        rows.push({ familyId, memberId: m.id, kind: "dose_reminder", dedupeKey: `dose:${d.id}:again:${ra.getTime()}:${m.id}`, body: r2.texto, options: opcoesDe(r2), context: { doseId: d.id }, notBefore: ra });
      }
      reagendadas.push(d.id);
    }
  }
  const n = await inserir(tx, rows);
  if (reagendadas.length) await tx.update(s.doseEvents).set({ remindAgainAt: null }).where(inArray(s.doseEvents.id, reagendadas));
  return n;
}

/** Avisos do portal (sino) que também vão ao WhatsApp: estoque baixo, receita vencendo, reposição. */
async function gerarAvisos(tx: Tx, familyId: string, dest: Destinatario[], agora: Date): Promise<number> {
  const desde = new Date(agora.getTime() - 48 * 3600_000);
  const avisos = await tx
    .select()
    .from(s.notifications)
    .where(and(isNull(s.notifications.whatsappSentAt), gte(s.notifications.createdAt, desde), inArray(s.notifications.kind, ["low_stock", "prescription_expiring", "replenishment_update"])));
  if (avisos.length === 0) return 0;
  const [meds, pats, itens] = await Promise.all([tx.select().from(s.medications), tx.select().from(s.patients), tx.select().from(s.stockItems)]);
  const rows: Novo[] = [];
  for (const a of avisos) {
    const m = dest.find((x) => x.id === a.memberId);
    if (!m) continue;
    const p = a.payload as Record<string, unknown>;
    let r: T.Resposta;
    let ctx: Record<string, unknown> = { notificationId: a.id };
    let tipo: string = a.kind;
    if (a.kind === "low_stock") {
      const med = meds.find((x) => x.id === p["medicationId"]);
      const pat = pats.find((x) => x.id === p["patientId"]);
      const item = itens.find((x) => x.id === p["stockItemId"]);
      if (!med || !pat) continue;
      r = T.estoqueBaixo({ paciente: T.primeiroNome(pat.name), remedio: med.name, dias: Number(p["daysLeft"] ?? 0), estimativa: item?.isEstimate ?? false });
      // "Eu cuido disso" só para quem pode (e só se o acesso é completo); os demais recebem só o aviso
      if (m.access !== "active" || !m.can("replenishment.manage")) r = { texto: r.texto.split("\n*1* —")[0]!.trimEnd() };
      ctx = { ...ctx, medicationId: med.id };
      tipo = "low_stock";
    } else if (a.kind === "prescription_expiring") {
      if (m.access !== "active" || !m.can("prescriptions.view")) continue;
      r = T.avisoReposicao({ titulo: a.title, corpo: a.body ?? "" });
      tipo = "rx_expiring";
    } else {
      if (m.access !== "active") continue;
      r = T.avisoReposicao({ titulo: a.title, corpo: a.body ?? "" });
      tipo = "replenishment";
    }
    rows.push({ familyId, memberId: m.id, kind: tipo, dedupeKey: `notif:${a.id}`, body: r.texto, options: opcoesDe(r), context: ctx, notBefore: agora });
  }
  return inserir(tx, rows);
}

async function gerarResumo(tx: Tx, familyId: string, tz: string, settings: FamilySettings, dest: Destinatario[], agora: Date): Promise<number> {
  const { date, minutes } = localParts(agora, tz);
  const [hh = 20, mm = 0] = settings.daily_summary_time.split(":").map(Number);
  const alvo = hh * 60 + mm;
  if (minutes < alvo || minutes > alvo + JANELA_RESUMO_MS / 60_000) return 0;
  const leitores = dest.filter((d) => d.can("dashboard.view"));
  if (leitores.length === 0) return 0;
  const dia = await resumoDoDia(tx, tz, settings, agora);
  if (dia.pacientes.length === 0) return 0;
  const critico = (await estoqueDaFamilia(tx, tz, settings.default_low_stock_days ?? DEFAULT_LOW_STOCK_DAYS, agora)).filter((l) => l.nivel === "critical");
  const rows: Novo[] = leitores.map((m) => {
    const veEstoque = m.can("stock.view");
    const r = T.resumoDiario({ data: dia.data, pacientes: dia.pacientes, estoqueCritico: veEstoque ? critico : [] });
    return { familyId, memberId: m.id, kind: "daily_summary", dedupeKey: `summary:${date}:${m.id}`, body: r.texto, options: [], context: {}, notBefore: agora };
  });
  return inserir(tx, rows);
}

/* ------------------------------------------------------------------ entrega */

const idComposto = (familyId: string, id: string) => `${familyId}.${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function separarId(raw: string, familiaDaChave?: string): { familyId: string; id: string } | null {
  const [a, b] = raw.includes(".") ? raw.split(".") : [familiaDaChave ?? "", raw];
  if (!a || !b || !UUID.test(a) || !UUID.test(b)) return null;
  if (familiaDaChave && a !== familiaDaChave) return null;
  return { familyId: a, id: b };
}

/**
 * O que enviar AGORA numa família. Gera o que falta, descarta o que ficou obsoleto (dose já resolvida, pessoa que perdeu o
 * número) e, se `reivindicar`, dá o lease às mensagens (sem `reivindicar` só espia: usado pelo simulador).
 */
export async function pendentes(
  familyId: string, opts: { reivindicar: boolean; limite?: number; agora?: Date; tipos?: string[] } = { reivindicar: true },
): Promise<MensagemPendente[]> {
  const agora = opts.agora ?? new Date();
  // quem reivindica sempre gera; quem só espia (simulador) reaproveita uma geração de poucos segundos atrás
  const recente = !opts.reivindicar && !opts.agora && Date.now() - (ultimaGeracao.get(familyId) ?? 0) < REUSO_LEITURA_MS;
  if (!recente) await gerarMensagens(familyId, agora);
  const entregues = await withFamilia(familyId, async (tx) => {
    const base = and(
      isNull(s.outboundMessages.sentAt), isNull(s.outboundMessages.discardedAt), isNull(s.outboundMessages.failedAt),
      lte(s.outboundMessages.notBefore, agora),
      opts.tipos?.length ? inArray(s.outboundMessages.kind, opts.tipos) : undefined,
      or(isNull(s.outboundMessages.claimedUntil), lte(s.outboundMessages.claimedUntil, agora)),
    );
    const q = tx
      .select({ o: s.outboundMessages, phone: s.members.phoneVerified, state: s.members.accessState, active: s.members.active, removed: s.members.removedAt, optOut: s.members.whatsappOptOutAt, sendNum: s.members.whatsappSendNumber })
      .from(s.outboundMessages)
      .innerJoin(s.members, eq(s.members.id, s.outboundMessages.memberId))
      .where(base)
      .orderBy(asc(s.outboundMessages.notBefore), asc(s.outboundMessages.id))
      .limit(opts.limite ?? 50);
    const rows = await (opts.reivindicar ? q.for("update", { of: s.outboundMessages, skipLocked: true }) : q);

    // obsoletas: dose já resolvida, número perdido, pessoa desativada, entregas demais
    const doseIds = rows.map((r) => r.o.context["doseId"]).filter((x): x is string => typeof x === "string");
    const abertas = doseIds.length ? new Set((await tx.select({ id: s.doseEvents.id }).from(s.doseEvents).where(and(inArray(s.doseEvents.id, doseIds), inArray(s.doseEvents.status, ["pending", "late", "missed"])))).map((d) => d.id)) : new Set<string>();
    const descartar: typeof rows = [];
    const boas: typeof rows = [];
    for (const r of rows) {
      const doseId = r.o.context["doseId"];
      const obsoleta =
        !r.phone || !r.active || r.removed || (r.state !== "active" && r.state !== "whatsapp_verified") ||
        // quem PAROU não recebe avisos agendados (o link de primeiro acesso, pedido por um administrador, é a exceção)
        (r.optOut !== null && r.o.kind !== "first_access_link") ||
        r.o.claimCount >= MAX_ENTREGAS || (typeof doseId === "string" && !abertas.has(doseId));
      (obsoleta ? descartar : boas).push(r);
    }
    if (opts.reivindicar && descartar.length) await tx.update(s.outboundMessages).set({ discardedAt: agora }).where(inArray(s.outboundMessages.id, descartar.map((r) => r.o.id)));
    if (opts.reivindicar && boas.length) {
      await tx
        .update(s.outboundMessages)
        .set({ claimedUntil: new Date(agora.getTime() + LEASE_MS), claimCount: sql`${s.outboundMessages.claimCount} + 1` })
        .where(inArray(s.outboundMessages.id, boas.map((r) => r.o.id)));
    }
    return boas;
  });

  if (opts.reivindicar) {
    // o "1" e o "2" da resposta passam a significar esta dose/este remédio
    for (const r of entregues) {
      const doseId = r.o.context["doseId"];
      const medicationId = r.o.context["medicationId"];
      if (typeof doseId === "string" || typeof medicationId === "string") {
        await lembrarNoContexto(familyId, r.o.memberId, {
          ...(typeof doseId === "string" && r.o.kind === "dose_reminder" ? { doseId } : {}),
          ...(typeof medicationId === "string" && r.o.options.length ? { medicationId } : {}),
        }, agora);
      }
    }
  }
  return entregues.map((r): MensagemPendente => ({
    id: idComposto(familyId, r.o.id),
    familiaId: familyId,
    membroId: r.o.memberId,
    telefone: r.phone!,
    numeroEnvio: r.sendNum,
    tipo: r.o.kind,
    texto: r.o.body,
    opcoes: r.o.options.map((rotulo, i) => ({ numero: i + 1, rotulo })),
    dedupe: r.o.dedupeKey,
    quando: r.o.notBefore.toISOString(),
  }));
}

/** Percorre todas as famílias ativas (chave de plataforma). Uma família com problema não derruba as outras. */
export async function pendentesDeTodas(opts: { reivindicar: boolean; limite?: number; agora?: Date; tipos?: string[] }): Promise<MensagemPendente[]> {
  const out: MensagemPendente[] = [];
  for (const f of await listarFamiliasAtivas()) {
    try {
      out.push(...(await pendentes(f.familiaId, opts)));
    } catch (e) {
      console.error("[fila] família falhou", (e as Error).name, (e as { code?: unknown }).code ?? "");
    }
  }
  return out;
}

/**
 * Confirma o envio (o worker, ANTES de mandar; o simulador, ao "enviar"). Idempotente: marcar de novo devolve `jaEnviada`.
 * `falhou` solta o lease para tentar de novo.
 * Também marca o aviso do portal como enviado ao WhatsApp (`notifications.whatsapp_sent_at`).
 */
export async function marcarEnviada(
  familyId: string, id: string, opts: { falhou?: boolean; agora?: Date } = {},
): Promise<{ ok: true; jaEnviada: boolean } | { ok: false; motivo: "nao_encontrada" }> {
  const agora = opts.agora ?? new Date();
  return withFamilia(familyId, async (tx) => {
    const [m] = await tx.select().from(s.outboundMessages).where(eq(s.outboundMessages.id, id)).for("update");
    if (!m) return { ok: false as const, motivo: "nao_encontrada" as const };
    if (m.sentAt) return { ok: true as const, jaEnviada: true };
    if (opts.falhou) {
      await tx.update(s.outboundMessages).set({ claimedUntil: null }).where(eq(s.outboundMessages.id, id));
      return { ok: true as const, jaEnviada: false };
    }
    await tx.update(s.outboundMessages).set({ sentAt: agora }).where(eq(s.outboundMessages.id, id));
    const nid = m.context["notificationId"];
    if (typeof nid === "string") await tx.update(s.notifications).set({ whatsappSentAt: agora }).where(and(eq(s.notifications.id, nid), isNull(s.notifications.whatsappSentAt)));
    return { ok: true as const, jaEnviada: false };
  });
}


/* ------------------------------------------------------------------ falha de envio (worker) */

export const MAX_TENTATIVAS_ENVIO = 4;
const recuoEnvioMs = (tentativas: number) => Math.min(60_000 * 2 ** Math.max(tentativas - 1, 0), 30 * 60_000);

/**
 * O provedor RECUSOU com clareza (nada saiu): desfaz o "enviada" e agenda nova tentativa com recuo. Depois de MAX_TENTATIVAS_ENVIO vira
 * erro definitivo e visível (`failed_at`, motivo curto SEM o texto da mensagem), nunca um laço. Devolve o destino.
 */
export async function registrarFalhaEnvio(
  familyId: string, id: string, motivo: string, agora: Date = new Date(),
): Promise<"nova_tentativa" | "erro_definitivo"> {
  const resumo = motivo.replace(/\s+/g, " ").replace(/\d{8,}/g, "…").slice(0, 200);
  return withFamilia(familyId, async (tx) => {
    const [m] = await tx.select({ n: s.outboundMessages.sendAttempts }).from(s.outboundMessages).where(eq(s.outboundMessages.id, id)).for("update");
    const tentativas = (m?.n ?? 0) + 1;
    if (tentativas >= MAX_TENTATIVAS_ENVIO) {
      await tx.update(s.outboundMessages).set({ sentAt: null, claimedUntil: null, sendAttempts: tentativas, failedAt: agora, errorSummary: resumo }).where(eq(s.outboundMessages.id, id));
      return "erro_definitivo" as const;
    }
    await tx.update(s.outboundMessages).set({
      sentAt: null, claimedUntil: null, sendAttempts: tentativas, errorSummary: resumo, notBefore: new Date(agora.getTime() + recuoEnvioMs(tentativas)),
    }).where(eq(s.outboundMessages.id, id));
    return "nova_tentativa" as const;
  });
}

/** Resumo para o portal: o que está na fila de saída e o que falhou em definitivo (sem texto de mensagem, sem telefone). */
export async function resumoSaida(familyId: string): Promise<{ pendentes: number; comErro: number; ultimosErros: Array<{ tipo: string; motivo: string; quando: Date }> }> {
  return withFamilia(familyId, async (tx) => {
    const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.outboundMessages)
      .where(and(isNull(s.outboundMessages.sentAt), isNull(s.outboundMessages.discardedAt), isNull(s.outboundMessages.failedAt)));
    const erros = await tx.select({ tipo: s.outboundMessages.kind, motivo: s.outboundMessages.errorSummary, quando: s.outboundMessages.failedAt })
      .from(s.outboundMessages).where(sql`${s.outboundMessages.failedAt} is not null`).orderBy(sql`${s.outboundMessages.failedAt} desc`).limit(5);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.outboundMessages).where(sql`${s.outboundMessages.failedAt} is not null`);
    return { pendentes: p?.n ?? 0, comErro: c?.n ?? 0, ultimosErros: erros.map((e) => ({ tipo: e.tipo, motivo: e.motivo ?? "sem detalhe", quando: e.quando ?? new Date() })) };
  });
}
