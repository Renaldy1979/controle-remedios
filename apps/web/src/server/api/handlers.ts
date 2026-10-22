import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashCodigoVerificacao, sha256 as sha, verificarTelefonePendente, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { addDays, localParts, prescriptionStatus, zonedToUtc } from "@medcuidar/domain";
import { requirePermission } from "../pg/guard";
import { confirmDose, effectiveStatus, snoozeDose, undoDose } from "../pg/doses";
import { claim, completeStep } from "../pg/replenishment";
import { authorizeFile } from "../pg/prescriptions";
import { signFileUrl, verifyFileSignature } from "../files";
import { appUrl } from "../env";
import { conversa, remetenteDesconhecido } from "../wa/conversa";
import { marcarEnviada, pendentes, pendentesDeTodas, separarId } from "../wa/fila";
import { proximasDosesHoje, visaoEstoque } from "../wa/queries";
import { loadWaActor, resolveSender } from "../wa/actor";
import { codigoBloqueado, codigoInvalido, numeroEmUso, numeroVerificado } from "../wa/texts";
import { ApiError, canonico, consulta, erroJson, idemConcluir, idemIniciar, json, rota, rotaFila, rotaRemetente } from "./core";
import { API_VERSION } from "./version";

/** Lógica de cada rota `/api/v1`. Os arquivos em `app/api/v1/**` só ligam método e caminho a estas funções. */

const uuid = z.string().uuid("Identificador inválido.");
const idDaRota = (p: Record<string, string>, k = "id") => uuid.parse(p[k]);
const canal = (origem: "plataforma" | "familia") => (origem === "plataforma" ? "whatsapp" : "system") as "whatsapp" | "system";

const p2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date, tz: string) => {
  const { minutes } = localParts(d, tz);
  return `${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`;
};

/* ------------------------------------------------------------------ doses */

export const dosesProximas = rota(async ({ actor, req, agora }) => {
  const q = z.object({ limite: z.coerce.number().int().min(1).max(30).default(8) }).parse(consulta(req));
  const lista = await proximasDosesHoje(actor, agora, q.limite);
  return lista.map((d) => ({
    id: d.id, pacienteId: d.patientId, paciente: d.paciente, remedioId: d.medicationId, remedio: d.remedio, hora: d.hora, dose: d.dose,
    situacao: d.status, agendadaPara: d.scheduledAt.toISOString(),
  }));
});

export const dosesDoDia = rota(async ({ actor, req, agora }) => {
  requirePermission(actor, "dashboard.view");
  const q = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(consulta(req));
  const data = q.data ?? localParts(agora, actor.timezone).date;
  const ini = zonedToUtc(data, 0, actor.timezone);
  const fim = zonedToUtc(addDays(data, 1), 0, actor.timezone);
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ d: s.doseEvents, med: s.medications.name, patient: s.patients.name })
      .from(s.doseEvents)
      .innerJoin(s.treatments, eq(s.treatments.id, s.doseEvents.treatmentId))
      .innerJoin(s.medications, eq(s.medications.id, s.doseEvents.medicationId))
      .innerJoin(s.patients, eq(s.patients.id, s.doseEvents.patientId))
      .where(and(gte(s.doseEvents.scheduledAt, ini), lt(s.doseEvents.scheduledAt, fim), isNull(s.treatments.deletedAt)))
      .orderBy(asc(s.doseEvents.scheduledAt));
    return {
      data,
      doses: rows.map(({ d, med, patient }) => ({
        id: d.id, pacienteId: d.patientId, paciente: patient.trim().split(/\s+/)[0], remedioId: d.medicationId, remedio: med,
        hora: hhmm(d.scheduledAt, actor.timezone), situacao: effectiveStatus(d.status, d.scheduledAt, agora, actor.settings),
        confirmadaPor: d.confirmedByMemberId ?? null, canal: d.channel ?? null,
      })),
    };
  });
});

const confirmarCorpo = z.object({ messageId: z.string().max(200).optional() }).default({});

/** Confirmar dose. Também serve para "registrar depois" (dose atrasada ou esquecida). Idempotente. */
const confirmarImpl = rota(async ({ actor, corpo, params, agora, origem, req }) => {
  const id = idDaRota(params);
  const c = confirmarCorpo.parse(corpo ?? {});
  const sourceMessageId = c.messageId ? `api:${actor.familyId}:${c.messageId}` : undefined;
  void req;
  const r = await confirmDose(actor, id, agora, { channel: canal(origem), ...(sourceMessageId ? { sourceMessageId } : {}) });
  return { id, confirmada: true, jaConfirmada: r.duplicate, estoqueBaixado: r.stockDeducted };
});
export const dosesConfirmar = confirmarImpl;
export const dosesRegistrarDepois = confirmarImpl;

export const dosesDesfazer = rota(async ({ actor, params, agora }) => {
  const r = await undoDose(actor, idDaRota(params), agora);
  return { id: idDaRota(params), estoqueRestaurado: r.stockRestored };
});

export const dosesLembrarDeNovo = rota(async ({ actor, params, corpo, agora }) => {
  const c = z.object({ minutos: z.number().int().positive().default(15) }).default({}).parse(corpo ?? {});
  await snoozeDose(actor, idDaRota(params), c.minutos, agora);
  return { id: idDaRota(params), lembrarEm: new Date(agora.getTime() + c.minutos * 60_000).toISOString() };
});

/* ------------------------------------------------------------------ estoque e reposição */

export const estoqueVisao = rota(async ({ actor, agora }) =>
  (await visaoEstoque(actor, agora)).map((l) => ({
    remedioId: l.medicationId, pacienteId: l.patientId, paciente: l.paciente, remedio: l.remedio, diasRestantes: l.dias, nivel: l.nivel, estimativa: l.estimativa,
  })));

export const reposicoesListar = rota(async ({ actor }) => {
  requirePermission(actor, "stock.view");
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ r: s.replenishments, med: s.medications.name, patient: s.patients.name })
      .from(s.replenishments)
      .innerJoin(s.medications, eq(s.medications.id, s.replenishments.medicationId))
      .innerJoin(s.patients, eq(s.patients.id, s.replenishments.patientId))
      .where(notInArray(s.replenishments.status, ["done", "cancelled"]));
    const steps = rows.length ? await tx.select().from(s.replenishmentSteps).where(inArray(s.replenishmentSteps.replenishmentId, rows.map((x) => x.r.id))) : [];
    return rows.map(({ r, med, patient }) => ({
      id: r.id, remedioId: r.medicationId, pacienteId: r.patientId, paciente: patient.trim().split(/\s+/)[0], remedio: med, situacao: r.status, abertaEm: r.openedAt.toISOString(),
      etapas: steps.filter((e) => e.replenishmentId === r.id).sort((a, b) => a.step - b.step).map((e) => ({ etapa: e.step, responsavelId: e.ownerMemberId, concluida: e.doneAt !== null, naoSeAplica: e.notApplicable })),
    }));
  });
});

export const reposicoesAssumir = rota(async ({ actor, params, agora }) => {
  await claim(actor, idDaRota(params), {}, agora);
  return { remedioId: idDaRota(params), assumida: true };
});

export const reposicoesAvancar = rota(async ({ actor, params, corpo, agora }) => {
  const c = z.object({ quantidade: z.number().positive().max(100_000).optional() }).default({}).parse(corpo ?? {});
  await completeStep(actor, idDaRota(params), c.quantidade ? { quantity: c.quantidade } : {}, agora);
  return { remedioId: idDaRota(params), avancada: true };
});

/* ------------------------------------------------------------------ cadastros (leitura) */

export const pacientesListar = rota(async ({ actor }) => {
  requirePermission(actor, "patients.view");
  return withFamilia(actor.familyId, async (tx) =>
    (await tx.select({ id: s.patients.id, nome: s.patients.name }).from(s.patients).where(isNull(s.patients.deletedAt)).orderBy(asc(s.patients.createdAt))));
});

export const remediosListar = rota(async ({ actor }) => {
  requirePermission(actor, "patients.view");
  return withFamilia(actor.familyId, async (tx) =>
    (await tx.select({ id: s.medications.id, nome: s.medications.name, via: s.medications.route, unidade: s.medications.controlUnit, exigeReceita: s.medications.requiresPrescription }).from(s.medications).where(isNull(s.medications.deletedAt)).orderBy(asc(s.medications.createdAt))));
});

/* ------------------------------------------------------------------ receitas (exigem acesso completo + permissão) */

export const receitasListar = rota(async ({ actor, agora }) => {
  requirePermission(actor, "prescriptions.view");
  const hoje = localParts(agora, actor.timezone).date;
  return withFamilia(actor.familyId, async (tx) => {
    const rows = await tx
      .select({ r: s.prescriptions, patient: s.patients.name })
      .from(s.prescriptions)
      .innerJoin(s.patients, eq(s.patients.id, s.prescriptions.patientId))
      .where(isNull(s.prescriptions.deletedAt))
      .orderBy(desc(s.prescriptions.issuedOn));
    const itens = rows.length ? await tx.select().from(s.prescriptionItems).where(inArray(s.prescriptionItems.prescriptionId, rows.map((x) => x.r.id))) : [];
    return rows.map(({ r, patient }) => {
      const info = prescriptionStatus(r.issuedOn, r.validUntil, hoje, { supersededById: r.supersededById ?? (r.status === "superseded" ? "manual" : null), hasPendingRequest: false });
      return {
        id: r.id, pacienteId: r.patientId, paciente: patient.trim().split(/\s+/)[0], emitidaEm: r.issuedOn, validaAte: r.validUntil, situacao: info.status,
        remedioIds: itens.filter((i) => i.prescriptionId === r.id).map((i) => i.medicationId),
      };
    });
  });
});

/** Páginas da receita com URL assinada de curta duração (5 a 10 min), presa à pessoa, ao arquivo e à família. */
export const receitasArquivos = rota(async ({ actor, params }) => {
  requirePermission(actor, "prescriptions.view");
  const id = idDaRota(params);
  return withFamilia(actor.familyId, async (tx) => {
    const files = await tx
      .select({ f: s.prescriptionFiles })
      .from(s.prescriptionFiles)
      .innerJoin(s.prescriptions, and(eq(s.prescriptions.id, s.prescriptionFiles.prescriptionId), isNull(s.prescriptions.deletedAt)))
      .where(eq(s.prescriptionFiles.prescriptionId, id))
      .orderBy(asc(s.prescriptionFiles.page));
    if (files.length === 0) throw new ApiError(404, "nao_encontrado", "Receita não encontrada.");
    await tx.insert(s.auditLog).values({ familyId: actor.familyId, actorMemberId: actor.memberId, action: "rx.api_urls", entity: "prescription", entityId: id, meta: { pages: files.length } });
    const out = [];
    for (const { f } of files) {
      const rel = await signFileUrl(f.id, "full", actor.memberId, actor.familyId); // /api/rx-file/<id>?v=&exp=&m=&sig=
      const q = new URL(rel, "http://x").searchParams;
      const url = `${appUrl()}/api/v1/arquivos/receita/${encodeURIComponent(f.id)}?exp=${q.get("exp")}&m=${actor.memberId}&f=${actor.familyId}&sig=${q.get("sig")}`;
      out.push({ pagina: f.page, mime: f.mime, url });
    }
    return out;
  });
});

/**
 * Entrega a página pela URL assinada (sem Bearer: a assinatura é a credencial, vale poucos minutos e prende arquivo,
 * pessoa e família). A pessoa precisa continuar ativa, com acesso completo e a permissão de ver receitas.
 */
export async function arquivoReceita(req: Request, fileId: string): Promise<NextResponse> {
  const deny = (status: number) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
  const q = new URL(req.url).searchParams;
  const memberId = q.get("m") ?? "";
  const familyId = q.get("f") ?? "";
  if (!uuid.safeParse(fileId).success || !uuid.safeParse(memberId).success || !uuid.safeParse(familyId).success) return deny(403);
  if (!(await verifyFileSignature(fileId, "full", Number(q.get("exp")), memberId, familyId, q.get("sig") ?? ""))) return deny(403);
  try {
    const actor = await loadWaActor(familyId, memberId, "active", "");
    if (!actor) return deny(403);
    const estado = await withFamilia(familyId, async (tx) => (await tx.select({ a: s.members.accessState }).from(s.members).where(eq(s.members.id, memberId)))[0]?.a);
    if (estado !== "active") return deny(403);
    requirePermission(actor, "prescriptions.view");
    const file = await authorizeFile(actor, fileId, "full");
    if (!file) return deny(404);
    const { rxStorage } = await import("../pg/rx-storage");
    const got = await rxStorage().read(file.storageFileId, "full");
    if (!got) return deny(404);
    return new NextResponse(got.bytes, { headers: { "Content-Type": got.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch {
    return deny(403);
  }
}

/* ------------------------------------------------------------------ conversa e verificação */

const conversaCorpo = z.object({
  messageId: z.string().min(1).max(200),
  texto: z.string().max(2000).optional(),
  acao: z.enum(["tomei", "lembrar", "cuido", "estoque", "proximas", "ajuda"]).optional(),
});

/** POST /conversa/mensagem — a conversa em código. Idempotente pelo `messageId` (ou pela Idempotency-Key, se enviada). */
export const conversaMensagem = rotaRemetente(async ({ telefone, corpo, agora }) => {
  const c = conversaCorpo.parse(corpo ?? {});
  if (c.texto === undefined && !c.acao) throw new ApiError(422, "invalido", "Envie `texto` ou `acao`.");
  const actor = await resolveSender(telefone);
  if (!actor) {
    const r = await remetenteDesconhecido(telefone, c.texto ?? "");
    return { resp: json({ respostas: r.respostas, intent: r.intent }) };
  }
  const chave = `msg:${c.messageId}`;
  const hash = sha(`${telefone}|${canonico(c)}`);
  const guardada = await idemIniciar(actor.familyId, chave, hash);
  if (guardada) return { resp: guardada, familiaId: actor.familyId };
  try {
    const r = await conversa({ telefone, messageId: c.messageId, ...(c.texto !== undefined ? { texto: c.texto } : {}), ...(c.acao ? { acao: c.acao } : {}), now: agora });
    const resp = json({ respostas: r.respostas, intent: r.intent });
    await idemConcluir(actor.familyId, chave, resp);
    return { resp, familiaId: actor.familyId };
  } catch (e) {
    await idemConcluir(actor.familyId, chave, erroJson(500, "erro_interno", "falhou")).catch(() => {});
    throw e;
  }
});


/** POST /telefone/verificar — rota "pré-membro": o remetente (ainda sem família) envia o código de 6 dígitos. Só chave de plataforma. */
export const telefoneVerificar = rotaRemetente(async ({ telefone, corpo }) => {
  const c = z.object({ codigo: z.string().regex(/^\d{6}$/, "O código tem 6 dígitos.") }).parse(corpo ?? {});
  const v = await verificarTelefonePendente(telefone, hashCodigoVerificacao(c.codigo));
  if (v.resultado === "verificado" && v.familiaId && v.membroId) {
    const nome = await withFamilia(v.familiaId, async (tx) => (await tx.select({ n: s.members.name }).from(s.members).where(eq(s.members.id, v.membroId!)))[0]?.n ?? "");
    await withFamilia(v.familiaId, (tx) => tx.insert(s.auditLog).values({ familyId: v.familiaId!, actorMemberId: v.membroId, action: "member.phone_verified", entity: "member", entityId: v.membroId, meta: {} }));
    return { resp: json({ verificado: true, respostas: [numeroVerificado({ nome })] }), familiaId: v.familiaId };
  }
  const texto = v.resultado === "bloqueado" ? codigoBloqueado() : v.resultado === "em_uso" ? numeroEmUso() : codigoInvalido();
  return { resp: json({ verificado: false, motivo: v.resultado, respostas: [texto] }, v.resultado === "bloqueado" ? 429 : 200) };
});

/* ------------------------------------------------------------------ fila de saída */

const TIPOS_DOSE = ["dose_reminder", "dose_missed"];
const TIPOS_ESTOQUE = ["low_stock", "rx_expiring", "replenishment"];
const TIPOS_RESUMO = ["daily_summary"];

function filaHandler(tipos: string[] | undefined) {
  return rotaFila(async ({ req, familiaId, agora }) => {
    const q = z.object({ somenteLer: z.enum(["0", "1", "true", "false"]).optional(), limite: z.coerce.number().int().min(1).max(200).optional() }).parse(consulta(req));
    const reivindicar = !(q.somenteLer === "1" || q.somenteLer === "true");
    const opts = { reivindicar, agora, ...(tipos ? { tipos } : {}), ...(q.limite ? { limite: q.limite } : {}) };
    const lista = familiaId ? await pendentes(familiaId, opts) : await pendentesDeTodas(opts);
    return { mensagens: lista, reivindicadas: reivindicar };
  });
}
export const lembretesPendentes = filaHandler(TIPOS_DOSE);
export const avisosEstoque = filaHandler(TIPOS_ESTOQUE);
export const avisosResumo = filaHandler(TIPOS_RESUMO);
/** Tudo o que está na fila (inclusive de outros tipos): usado pelo simulador com somenteLer=1. */
export const filaCompleta = filaHandler(undefined);

export const lembreteEnviado = rotaFila(async ({ params, corpo, familiaId, agora }) => {
  const c = z.object({ falhou: z.boolean().optional() }).default({}).parse(corpo ?? {});
  const id = separarId(String(params["id"] ?? ""), familiaId ?? undefined);
  if (!id) throw new ApiError(404, "nao_encontrado", "Mensagem não encontrada.");
  const r = await marcarEnviada(id.familyId, id.id, { ...(c.falhou ? { falhou: true } : {}), agora });
  if (!r.ok) throw new ApiError(404, "nao_encontrado", "Mensagem não encontrada.");
  return { enviada: !c.falhou, jaEnviada: r.jaEnviada };
});

/* ------------------------------------------------------------------ sistema */

export const sistemaSaude = rotaFila(async () => ({ ok: true, versao: API_VERSION }), { soPlataforma: true });
