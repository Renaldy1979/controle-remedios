"use server";
import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { can } from "@medcuidar/shared";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { ForbiddenError, UserError } from "../pg/errors";
import { isAdmin } from "../pg/guard";
import { simulatorEnabled } from "../env";
import { simulatorSecret } from "../api/core";
import { stampLabel } from "../pg/stamp";
import { resolveSender } from "./actor";
import { issueFirstAccessLink } from "./first-access";
import { criarChaveFamilia, listarChavesFamilia, revogarChaveFamilia } from "./keys";
import { meuWhatsapp, startPhoneVerification } from "./phone-verify";
import { lembrarNoContexto } from "./state";
import { saveMyPhone } from "../pg/members";

/** Server Actions de Configurações › WhatsApp e do simulador. A família e a pessoa vêm SEMPRE da sessão. */

export type R<T = void> = { ok: true; data: T } | { ok: false; message: string };

async function sessao() {
  const { getContext } = await import("../pg/access");
  const ctx = await getContext();
  if (!ctx) throw new UserError("Sua sessão expirou. Entre de novo.");
  return ctx;
}

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, message: "Seu perfil não tem permissão para fazer isso." };
    if (e instanceof UserError) return { ok: false, message: e.message };
    if (e instanceof z.ZodError) return { ok: false, message: e.issues[0]?.message ?? "Confira os dados." };
    console.error("[whatsapp] falhou", (e as Error).name, (e as { code?: unknown }).code ?? "");
    return { ok: false, message: "Não foi possível concluir. Tente de novo." };
  }
}

/* ------------------------------------------------------------------ Configurações › WhatsApp */

export interface PessoaWa {
  id: string;
  nome: string;
  perfil: string;
  acesso: "invited" | "whatsapp_verified" | "active";
  numero: "verificado" | "pendente" | "sem_numero";
  telefone: string;
  eu: boolean;
}
export interface ChaveWa {
  id: string;
  nome: string;
  prefixo: string;
  criadaEm: string;
  ultimoUso: string;
  revogada: boolean;
}
/** WhatsApp do sistema (instância, worker, fila e IA), para a tela do Administrador. Nada de telefone nem de conteúdo de mensagem. */
export interface StatusWa {
  provedor: string;
  /** variáveis da Evolution Go presentes (ou provedor fake) */
  configurado: boolean;
  instancia: { estado: "conectada" | "desconectada" | "aguardando"; desde: string | null; consultadaEm: string | null };
  worker: { habilitado: boolean; ligado: boolean; ultimoBatimento: string | null };
  entrada: { pendentes: number; processando: number; erros: number; maisAntigaSeg: number | null; ultimosErros: Array<{ motivo: string; quando: string; tentativas: number }> };
  saida: { pendentes: number; comErro: number; ultimosErros: Array<{ tipo: string; motivo: string; quando: string }> };
  /** a Evolution recusou a chave (401/403): o envio está pausado até `pausadoAte` */
  chave: { recusada: boolean; pausadoAte: string | null; motivo: string };
  /** último motivo de falha ao ler áudio/foto (Gemini ou download); null = a última leitura deu certo */
  midia: { ultimaFalha: { motivo: string; quando: string } | null; modelo: string };
  ia: { configurada: boolean; modelo: string; midia: boolean; mes: string; usadoUsd: number; limiteUsd: number; chamadas: number; excedeu: boolean };
}
export interface EstadoWa {
  eu: { verificado: string; pendente: string; codigoAtivo: boolean; codigoExpiraEm: string | null };
  pessoas: PessoaWa[];
  admin: boolean;
  chaves: ChaveWa[];
  simulador: boolean;
  status: StatusWa | null;
}

const dia = (d: Date | null, tz: string) => (d ? stampLabel(d, tz) : "nunca");
export async function estadoWhatsappAction(): Promise<R<EstadoWa>> {
  return run(async () => {
    const ctx = await sessao();
    const eu = await meuWhatsapp(ctx);
    const verPessoas = can(ctx.member, "members.manage");
    const adm = isAdmin(ctx);
    const pessoas = !verPessoas ? [] : await withFamilia(ctx.familyId, async (tx) => {
      const rows = await tx
        .select({ m: s.members, perfil: s.profiles.name })
        .from(s.members)
        .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
        .where(eq(s.members.active, true));
      return rows.map(({ m, perfil }): PessoaWa => ({
        id: m.id, nome: m.name, perfil, acesso: m.accessState, eu: m.id === ctx.memberId,
        numero: m.phoneVerified ? "verificado" : m.phonePending ? "pendente" : "sem_numero",
        telefone: formatPhone(m.phoneVerified ?? m.phonePending ?? ""),
      }));
    });
    const mapa = (k: { id: string; nome: string; prefixo: string; criadaEm: Date; ultimoUso: Date | null; revogadaEm: Date | null }): ChaveWa => ({
      id: k.id, nome: k.nome, prefixo: k.prefixo, criadaEm: dia(k.criadaEm, ctx.timezone), ultimoUso: dia(k.ultimoUso, ctx.timezone), revogada: k.revogadaEm !== null,
    });
    return {
      eu: { verificado: formatPhone(eu.verificado), pendente: formatPhone(eu.pendente), codigoAtivo: eu.codigoExpiraEm !== null, codigoExpiraEm: eu.codigoExpiraEm?.toISOString() ?? null },
      pessoas, admin: adm,
      chaves: adm ? (await listarChavesFamilia(ctx)).map(mapa) : [],
      simulador: simulatorEnabled() && adm,
      status: adm ? await statusWhatsapp(ctx.familyId, ctx.timezone) : null,
    };
  });
}

/** Informa o número da própria conta e devolve o código de 6 dígitos (aparece só agora; no banco fica o hash). */
export async function iniciarVerificacaoAction(telefone: string): Promise<R<{ codigo: string; telefone: string; expiraEm: string; expiraHora: string }>> {
  return run(async () => {
    const ctx = await sessao();
    const r = await startPhoneVerification(ctx, z.string().max(40).parse(telefone));
    return { codigo: r.code, telefone: formatPhone(r.phone), expiraEm: r.expiresAt.toISOString(), expiraHora: r.expiresLabel };
  });
}

export async function removerMeuNumeroAction(): Promise<R> {
  return run(async () => {
    const ctx = await sessao();
    await saveMyPhone(ctx, "");
    await withFamilia(ctx.familyId, (tx) =>
      tx.update(s.members).set({ phonePending: null, phoneVerified: null, verificationCodeHash: null, verificationExpiresAt: null, verificationAttempts: 0 }).where(eq(s.members.id, ctx.memberId)));
  });
}

export async function criarChaveAction(nome: string): Promise<R<{ chave: string }>> {
  return run(async () => {
    const ctx = await sessao();
    const n = z.string().trim().min(2, "Dê um nome à chave (2 a 60 letras).").max(60).parse(nome);
    return { chave: (await criarChaveFamilia(ctx, n)).chave };
  });
}

export async function revogarChaveAction(id: string): Promise<R> {
  return run(async () => {
    const ctx = await sessao();
    await revogarChaveFamilia(ctx, z.string().uuid().parse(id));
  });
}

/** "Reenviar link de acesso" (admin): novo link de uso único para quem entrou pelo WhatsApp e ainda não terminou o cadastro. */
export async function reenviarLinkAcessoAction(memberId: string): Promise<R<{ link: string }>> {
  return run(async () => {
    const ctx = await sessao();
    if (!can(ctx.member, "members.manage")) throw new ForbiddenError("members.manage");
    const id = z.string().uuid().parse(memberId);
    const m = await withFamilia(ctx.familyId, async (tx) => (await tx.select().from(s.members).where(eq(s.members.id, id)))[0]);
    if (!m || m.accessState !== "whatsapp_verified") throw new UserError("Essa pessoa não está esperando o primeiro acesso.");
    const link = await issueFirstAccessLink(ctx.familyId, id, ctx.memberId, "member.first_access_link_resend");
    // o link também vai na fila do WhatsApp dessa pessoa (número verificado), uma vez por link
    await withFamilia(ctx.familyId, (tx) =>
      tx.insert(s.outboundMessages).values({
        familyId: ctx.familyId, memberId: id, kind: "first_access_link", dedupeKey: `link:${link.linkId}`,
        body: `🔗 *Link de primeiro acesso*\nDefina seu e-mail e senha aqui (vale 24 h, uso único):\n${link.url}`, options: [], context: {},
      }).onConflictDoNothing());
    return { link: link.url };
  });
}

/* ------------------------------------------------------------------ simulador (só admin e só com SIMULATOR_ENABLED=1) */

async function sessaoSimulador() {
  const ctx = await sessao();
  if (!simulatorEnabled()) throw new UserError("O simulador está desligado neste ambiente.");
  if (!isAdmin(ctx)) throw new ForbiddenError("simulador");
  return ctx;
}

export interface FalarComo {
  id: string;
  nome: string;
  telefone: string;
  situacao: "verificado" | "pendente" | "sem_numero";
}

export async function simPessoasAction(): Promise<R<FalarComo[]>> {
  return run(async () => {
    const ctx = await sessaoSimulador();
    return withFamilia(ctx.familyId, async (tx) => {
      const rows = await tx.select().from(s.members).where(eq(s.members.active, true));
      return rows
        .map((m): FalarComo => ({
          id: m.id, nome: m.name, telefone: m.phoneVerified ?? m.phonePending ?? "",
          situacao: m.phoneVerified ? "verificado" : m.phonePending ? "pendente" : "sem_numero",
        }))
        .filter((p) => p.telefone);
    });
  });
}

const simHeaders = (extra: Record<string, string>) => ({ "content-type": "application/json", "x-mc-simulador": simulatorSecret(), ...extra });
const BASE = "http://simulador.local/api/v1";
const semParams = { params: Promise.resolve({}) };

export interface RespostaSim {
  respostas: Array<{ texto: string }>;
  /** quantas vezes o sistema mostraria "digitando…" (simulado) */
  digitando: number;
}

/**
 * Envia a mensagem pela MESMA fila e pelo MESMO worker do WhatsApp real (`simulador.ts`): entra em `whatsapp_inbound`, o núcleo da
 * conversa responde (e o agente de IA, se houver ANTHROPIC_API_KEY) e a resposta sai por um provedor `fake`. Nada é enviado a ninguém.
 */
export async function simEnviarAction(input: { telefone: string; texto?: string; acao?: string }): Promise<R<RespostaSim>> {
  return run(async () => {
    const ctx = await sessaoSimulador();
    const tel = normalizePhone(z.string().max(40).parse(input.telefone));
    if (!tel) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
    // o simulador só fala como gente DESTA família; um número verificado em outro cadastro é recusado
    const dono = await resolveSender(tel);
    if (dono && dono.familyId !== ctx.familyId) throw new UserError("Esse número já pertence a outro cadastro e não pode ser usado aqui.");
    const { conversarNoSimulador } = await import("./simulador");
    return conversarNoSimulador(tel, { ...(input.texto !== undefined ? { texto: input.texto } : {}), ...(input.acao ? { acao: input.acao } : {}) });
  });
}

/** "Enviar agora (simulado)": o agendador de verdade, mas só desta família e com o provedor fake. Devolve o que "saiu". */
export async function simEnviarAgoraAction(): Promise<R<Array<{ para: string; telefone: string; texto: string }>>> {
  return run(async () => {
    const ctx = await sessaoSimulador();
    const { enviarAgoraNoSimulador } = await import("./simulador");
    return enviarAgoraNoSimulador(ctx.familyId);
  });
}

export interface FilaSim {
  id: string;
  para: string;
  telefone: string;
  tipo: string;
  texto: string;
  quando: string;
}

/** O painel "Mensagens que o sistema enviaria agora": lê a fila pelas rotas da API (só espia; não reivindica). */
export async function simFilaAction(): Promise<R<FilaSim[]>> {
  return run(async () => {
    const ctx = await sessaoSimulador();
    const h = await import("../api/handlers");
    const headers = simHeaders({ "x-mc-simulador-familia": ctx.familyId });
    const out: FilaSim[] = [];
    const nomes = await withFamilia(ctx.familyId, async (tx) => new Map((await tx.select({ id: s.members.id, n: s.members.name }).from(s.members)).map((m) => [m.id, m.n])));
    // uma só chamada à fila completa (a geração roda uma vez); é a mesma rota de diagnóstico da API
    const resp = await h.filaCompleta(new NextRequest(`${BASE}/sistema/fila?somenteLer=1`, { headers }), semParams);
    const j = (await resp.json()) as { dados?: { mensagens: Array<{ id: string; membroId: string; telefone: string; tipo: string; texto: string; quando: string }> } };
    for (const m of j.dados?.mensagens ?? []) out.push({ id: m.id, para: nomes.get(m.membroId) ?? "—", telefone: m.telefone, tipo: m.tipo, texto: m.texto, quando: m.quando });
    return out.sort((a, b) => a.quando.localeCompare(b.quando));
  });
}

/** "Marcar como enviada": como o worker faria. O "1" e o "2" passam a valer para essa mensagem, e ela aparece na conversa da pessoa. */
export async function simMarcarEnviadaAction(id: string): Promise<R<FilaSim | null>> {
  return run(async () => {
    const ctx = await sessaoSimulador();
    const [familyId, messageId] = z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/i).parse(id).split(".") as [string, string];
    if (familyId !== ctx.familyId) throw new ForbiddenError("simulador");
    const msg = await withFamilia(ctx.familyId, async (tx) => {
      const [r] = await tx
        .select({ o: s.outboundMessages, phone: s.members.phoneVerified })
        .from(s.outboundMessages)
        .innerJoin(s.members, eq(s.members.id, s.outboundMessages.memberId))
        .where(eq(s.outboundMessages.id, messageId));
      return r;
    });
    if (!msg) throw new UserError("Mensagem não encontrada.");
    const h = await import("../api/handlers");
    const resp = await h.lembreteEnviado(
      new NextRequest(`${BASE}/lembretes/${id}/enviado`, { method: "POST", headers: simHeaders({ "x-mc-simulador-familia": ctx.familyId }), body: "{}" }),
      { params: Promise.resolve({ id }) },
    );
    if (!resp.ok) throw new UserError("Não foi possível marcar como enviada.");
    const doseId = msg.o.context["doseId"];
    const medicationId = msg.o.context["medicationId"];
    await lembrarNoContexto(ctx.familyId, msg.o.memberId, {
      ...(typeof doseId === "string" && msg.o.kind === "dose_reminder" ? { doseId } : {}),
      ...(typeof medicationId === "string" && msg.o.options.length ? { medicationId } : {}),
    }, new Date());
    return { id, para: "", telefone: msg.phone ?? "", tipo: msg.o.kind, texto: msg.o.body, quando: msg.o.notBefore.toISOString() };
  });
}

/* ------------------------------------------------------------------ WhatsApp do sistema (Lote 4B): estado, IA e limite */

async function sessaoAdmin() {
  const ctx = await sessao();
  if (!isAdmin(ctx)) throw new ForbiddenError("whatsapp_status");
  return ctx;
}

/** Monta o painel do administrador: instância, worker, fila de entrada/saída, uso e custo de IA no mês. */
export async function statusWhatsapp(familyId: string, tz: string): Promise<StatusWa> {
  const [{ resumoEntrada }, { resumoSaida }, { lerRuntime }, { resumoDeUso }, prov, { modeloConfigurado }, { geminiModelo }] = await Promise.all([
    import("./inbound"), import("./fila"), import("./runtime"), import("./ia/uso"), import("./provider"), import("./ia/modelo"), import("./ia/midia"),
  ]);
  const [entrada, saida, inst, worker, uso, auth, midia] = await Promise.all([
    resumoEntrada(), resumoSaida(familyId), lerRuntime<{ conectada: boolean | null; desde: string; consultadaEm: string }>("instancia"),
    lerRuntime<{ em: string }>("worker"), resumoDeUso(familyId, tz), lerRuntime<{ falhas: number; pausadoAte: string | null; alertada: boolean }>("auth"), lerRuntime<{ motivo: string | null; em: string }>("midia"),
  ]);
  const provedor = prov.provedorConfigurado();
  const configurado = provedor === "fake" ? true : provedor === "meta" ? false : prov.evolutionConfigurada();
  const batimento = worker?.em ?? null;
  const ligado = !!batimento && Date.now() - Date.parse(batimento) < 3 * 60_000;
  return {
    provedor, configurado,
    instancia: {
      estado: !configurado || !inst || inst.conectada === null ? "aguardando" : inst.conectada ? "conectada" : "desconectada",
      desde: inst?.desde ?? null, consultadaEm: inst?.consultadaEm ?? null,
    },
    chave: {
      recusada: !!auth && (auth.falhas > 0 || auth.alertada || (!!auth.pausadoAte && Date.parse(auth.pausadoAte) > Date.now())),
      pausadoAte: auth?.pausadoAte && Date.parse(auth.pausadoAte) > Date.now() ? stampLabel(new Date(auth.pausadoAte), tz) : null,
      motivo: "Evolution recusou a chave (401): use o token da instância em EVOLUTION_INSTANCE_TOKEN",
    },
    midia: { ultimaFalha: midia?.motivo ? { motivo: midia.motivo, quando: stampLabel(new Date(midia.em), tz) } : null, modelo: geminiModelo() },
    worker: { habilitado: process.env["WHATSAPP_WORKER_ENABLED"] === "1", ligado, ultimoBatimento: batimento },
    entrada: {
      pendentes: entrada.pendentes, processando: entrada.processando, erros: entrada.erros, maisAntigaSeg: entrada.maisAntigaSeg,
      ultimosErros: entrada.ultimosErros.map((e) => ({ motivo: e.motivo, quando: stampLabel(e.quando, tz), tentativas: e.tentativas })),
    },
    saida: { pendentes: saida.pendentes, comErro: saida.comErro, ultimosErros: saida.ultimosErros.map((e) => ({ tipo: e.tipo, motivo: e.motivo, quando: stampLabel(e.quando, tz) })) },
    ia: {
      configurada: !!(process.env["ANTHROPIC_API_KEY"] ?? "").trim(), modelo: modeloConfigurado(), midia: !!(process.env["GEMINI_API_KEY"] ?? "").trim(),
      mes: uso.mes, usadoUsd: uso.usadoMicros / 1_000_000, limiteUsd: uso.limiteMicros / 1_000_000, chamadas: uso.chamadas, excedeu: uso.excedeu,
    },
  };
}

/** Botão "Consultar agora": pergunta ao provedor se o número está conectado e guarda o resultado. */
export async function consultarInstanciaAction(): Promise<R<StatusWa>> {
  return run(async () => {
    const ctx = await sessaoAdmin();
    const { criarProvedor } = await import("./provider");
    const { monitorarInstancia } = await import("./alertas");
    const p = criarProvedor();
    if (!p) throw new UserError("O WhatsApp ainda não está configurado neste ambiente (veja docs/11-whatsapp-direto.md).");
    await monitorarInstancia(p);
    return statusWhatsapp(ctx.familyId, ctx.timezone);
  });
}

/** Limite mensal de IA da família, em dólares (0 pausa o assistente de perguntas). */
export async function definirLimiteIaAction(usd: number): Promise<R<StatusWa>> {
  return run(async () => {
    const ctx = await sessaoAdmin();
    const v = z.number({ invalid_type_error: "Informe um valor em dólares." }).min(0, "O valor não pode ser negativo.").max(1000, "Máximo de US$ 1.000 por mês.").parse(usd);
    const { definirLimiteMensal } = await import("./ia/uso");
    await definirLimiteMensal(ctx.familyId, v);
    await withFamilia(ctx.familyId, (tx) => tx.insert(s.auditLog).values({ familyId: ctx.familyId, actorMemberId: ctx.memberId, action: "ai.limit.set", entity: "family_integration", entityId: ctx.familyId, meta: { usd: v } }));
    return statusWhatsapp(ctx.familyId, ctx.timezone);
  });
}
