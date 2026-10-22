"use server";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { criarChavePlataforma, listarChavesPlataforma, revogarChavePlataforma, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { can } from "@medcuidar/shared";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { ForbiddenError, UserError } from "../pg/errors";
import { isAdmin } from "../pg/guard";
import { platformKeysFromPortal, simulatorEnabled } from "../env";
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
export interface EstadoWa {
  eu: { verificado: string; pendente: string; codigoAtivo: boolean; codigoExpiraEm: string | null };
  pessoas: PessoaWa[];
  admin: boolean;
  chaves: ChaveWa[];
  chavesPlataforma: ChaveWa[] | null;
  simulador: boolean;
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
      chavesPlataforma: adm && platformKeysFromPortal() ? (await listarChavesPlataforma()).map((k) => mapa({ ...k, prefixo: "cpl_" })) : null,
      simulador: simulatorEnabled() && adm,
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

export async function criarChaveAction(nome: string, tipo: "familia" | "plataforma"): Promise<R<{ chave: string }>> {
  return run(async () => {
    const ctx = await sessao();
    const n = z.string().trim().min(2, "Dê um nome à chave (2 a 60 letras).").max(60).parse(nome);
    if (tipo === "plataforma") {
      if (!isAdmin(ctx)) throw new UserError("Só um Administrador cuida das chaves de API.");
      if (!platformKeysFromPortal()) throw new UserError("A chave da plataforma não é criada por aqui neste ambiente.");
      const k = await criarChavePlataforma(n, ["conversa"]);
      await withFamilia(ctx.familyId, (tx) => tx.insert(s.auditLog).values({ familyId: ctx.familyId, actorMemberId: ctx.memberId, action: "api_key.create", entity: "api_key", entityId: k.id, meta: { kind: "plataforma" } }));
      return { chave: k.chave };
    }
    return { chave: (await criarChaveFamilia(ctx, n)).chave };
  });
}

export async function revogarChaveAction(id: string, tipo: "familia" | "plataforma"): Promise<R> {
  return run(async () => {
    const ctx = await sessao();
    const kid = z.string().uuid().parse(id);
    if (tipo === "plataforma") {
      if (!isAdmin(ctx) || !platformKeysFromPortal()) throw new ForbiddenError("api_key");
      if (!(await revogarChavePlataforma(kid))) throw new UserError("Chave não encontrada ou já revogada.");
      return;
    }
    await revogarChaveFamilia(ctx, kid);
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
  respostas: Array<{ texto: string; opcoes?: Array<{ numero: number; rotulo: string }> }>;
  intent: string;
}

/**
 * Envia a mensagem pela MESMA rota que o N8N usará (POST /api/v1/conversa/mensagem), dentro do processo, com o segredo
 * interno do simulador no lugar da chave cpl_. Não existe canal real neste lote: nada é enviado a ninguém.
 */
export async function simEnviarAction(input: { telefone: string; texto?: string; acao?: string }): Promise<R<RespostaSim>> {
  return run(async () => {
    const ctx = await sessaoSimulador();
    const tel = normalizePhone(z.string().max(40).parse(input.telefone));
    if (!tel) throw new UserError("Confira o número com DDD, por exemplo (11) 91234-5678.");
    // o simulador só fala como gente DESTA família; um número verificado em outro cadastro é recusado
    const dono = await resolveSender(tel);
    if (dono && dono.familyId !== ctx.familyId) throw new UserError("Esse número já pertence a outro cadastro e não pode ser usado aqui.");
    const h = await import("../api/handlers");
    const corpo = { messageId: `sim-${randomUUID()}`, ...(input.texto !== undefined ? { texto: input.texto } : {}), ...(input.acao ? { acao: input.acao } : {}) };
    const resp = await h.conversaMensagem(new NextRequest(`${BASE}/conversa/mensagem`, { method: "POST", headers: simHeaders({ "x-telefone": tel }), body: JSON.stringify(corpo) }), semParams);
    const j = (await resp.json()) as { dados?: RespostaSim; erro?: { mensagem: string } };
    if (!resp.ok || !j.dados) throw new UserError(j.erro?.mensagem ?? "A API não respondeu.");
    return j.dados;
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
    // uma só chamada à fila completa (a geração roda uma vez); as rotas por tipo são as mesmas que o N8N usa
    const resp = await h.filaCompleta(new NextRequest(`${BASE}/sistema/fila?somenteLer=1`, { headers }), semParams);
    const j = (await resp.json()) as { dados?: { mensagens: Array<{ id: string; membroId: string; telefone: string; tipo: string; texto: string; quando: string }> } };
    for (const m of j.dados?.mensagens ?? []) out.push({ id: m.id, para: nomes.get(m.membroId) ?? "—", telefone: m.telefone, tipo: m.tipo, texto: m.texto, quando: m.quando });
    return out.sort((a, b) => a.quando.localeCompare(b.quando));
  });
}

/** "Marcar como enviada": como o N8N faria. O "1" e o "2" passam a valer para essa mensagem, e ela aparece na conversa da pessoa. */
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
