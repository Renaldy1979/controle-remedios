import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { auditarPlataforma, resolverApiKeyPorHash, sha256, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { ForbiddenError, UserError } from "../pg/errors";
import { resolveSender, type WaActor } from "../wa/actor";
import { simulatorEnabled } from "../env";

/**
 * Núcleo da API pública `/api/v1` (docs/10), no padrão do projeto controle-financeiro:
 *  - Authorization: Bearer <chave>. `cdf_` = uma família; `cpl_` = plataforma (N8N), escopo `conversa`.
 *    Só o sha256 da chave é guardado; a busca é por hash (índice único), a chave em claro nunca é comparada nem logada.
 *  - X-Telefone (só dígitos) identifica o usuário: só número VERIFICADO e membro ativo. Desconhecido, não verificado,
 *    desativado ou de outra família = a mesma resposta 404 genérica.
 *  - Idempotency-Key (24 h): resposta guardada; requisições simultâneas com a mesma chave se serializam num lock consultivo.
 *  - Erros: { erro: { codigo, mensagem, detalhes? } }. Limite simples de requisições por telefone.
 *  - Chamadas de plataforma são auditadas (telefone mascarado).
 */

export class ApiError extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public detalhes?: unknown) {
    super(mensagem);
    this.name = "ApiError";
  }
}

export const json = <T>(dados: T, status = 200) => NextResponse.json({ dados }, { status });

export function erroJson(status: number, codigo: string, mensagem: string, detalhes?: unknown) {
  return NextResponse.json({ erro: { codigo, mensagem, ...(detalhes ? { detalhes } : {}) } }, { status });
}

export const MSG_TELEFONE = "Telefone não encontrado, não verificado ou sem acesso.";

/* ------------------------------------------------------------------ autenticação */

type Auth =
  | { tipo: "familia"; chaveId: string; familiaId: string }
  | { tipo: "plataforma"; chaveId: string | null; escopos: string[]; simulador?: boolean };

/**
 * O simulador do portal chama a MESMA rota, dentro do processo, com um segredo gerado na subida do servidor (nunca
 * sai do processo nem vai para o cliente). Só vale com SIMULATOR_ENABLED=1. Em produção sem a variável, não existe.
 */
const SIM_KEY = Symbol.for("medcuidar.simulatorSecret");
type G = typeof globalThis & { [SIM_KEY]?: string };
export function simulatorSecret(): string {
  const g = globalThis as G;
  return (g[SIM_KEY] ??= randomBytes(32).toString("hex"));
}

async function autenticar(req: NextRequest): Promise<Auth | NextResponse> {
  const sim = req.headers.get("x-mc-simulador");
  if (sim) {
    if (simulatorEnabled() && sim === simulatorSecret()) {
      // com x-mc-simulador-familia a chamada fica presa a UMA família (painel da fila do simulador)
      const fam = req.headers.get("x-mc-simulador-familia") ?? "";
      if (/^[0-9a-f-]{36}$/i.test(fam)) return { tipo: "familia", chaveId: "simulador", familiaId: fam };
      return { tipo: "plataforma", chaveId: null, escopos: ["conversa"], simulador: true };
    }
    return erroJson(401, "nao_autorizado", "Chave de API inválida ou revogada.");
  }
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return erroJson(401, "nao_autorizado", "Envie o cabeçalho Authorization: Bearer <chave>.");
  const chave = m[1]!;
  if (!chave.startsWith("cdf_") && !chave.startsWith("cpl_")) return erroJson(401, "nao_autorizado", "Chave de API inválida ou revogada.");
  const k = await resolverApiKeyPorHash(sha256(chave));
  if (!k || (chave.startsWith("cdf_") && k.tipo !== "familia") || (chave.startsWith("cpl_") && k.tipo !== "plataforma")) {
    return erroJson(401, "nao_autorizado", "Chave de API inválida ou revogada.");
  }
  return k.tipo === "familia" ? { tipo: "familia", chaveId: k.keyId, familiaId: k.familiaId } : { tipo: "plataforma", chaveId: k.keyId, escopos: k.escopos };
}

/* ------------------------------------------------------------------ limite de requisições (por processo) */

const JANELA_LIMITE_MS = 60_000;
const MAX_POR_JANELA = 60;
const hits = new Map<string, number[]>();

/** Limite simples por telefone: 60 requisições por minuto. Devolve os segundos até liberar, ou 0. */
export function limiteExcedido(chave: string, agora = Date.now(), max = MAX_POR_JANELA): number {
  const recentes = (hits.get(chave) ?? []).filter((t) => agora - t < JANELA_LIMITE_MS);
  if (recentes.length >= max) {
    hits.set(chave, recentes);
    return Math.max(1, Math.ceil((recentes[0]! + JANELA_LIMITE_MS - agora) / 1000));
  }
  recentes.push(agora);
  hits.set(chave, recentes);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => agora - t >= JANELA_LIMITE_MS)) hits.delete(k);
  return 0;
}
export const _limparLimites = () => hits.clear();

/* ------------------------------------------------------------------ idempotência */

const JANELA_IDEM_MS = 24 * 60 * 60 * 1000;
const EM_ANDAMENTO_MS = 2 * 60 * 1000;
const CHAVE_IDEM_RE = /^[\x21-\x7e]{1,200}$/;

/** JSON com chaves ordenadas: a ordem dos campos não muda o hash. */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}
export const hashRequisicao = (req: NextRequest, corpo: unknown) => sha256(`${req.method}\n${req.nextUrl.pathname}${req.nextUrl.search}\n${canonico(corpo)}`);

/** Reserva a chave (ou devolve a resposta guardada). O lock consultivo só dura o tempo de ler e reservar. */
export async function idemIniciar(familyId: string, chave: string, hash: string): Promise<NextResponse | null> {
  return withFamilia(familyId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${familyId}:${chave}`}, 0))`);
    const [row] = await tx.select().from(s.idempotency).where(and(eq(s.idempotency.familyId, familyId), eq(s.idempotency.key, chave)));
    if (row) {
      const idade = Date.now() - row.createdAt.getTime();
      if (idade > JANELA_IDEM_MS || (row.status === null && idade > EM_ANDAMENTO_MS)) {
        await tx.delete(s.idempotency).where(eq(s.idempotency.id, row.id));
      } else {
        if (row.requestHash !== hash) {
          return erroJson(422, "idempotencia_conflito", "Esta Idempotency-Key já foi usada com outra requisição. Gere uma nova chave para uma nova operação.");
        }
        if (row.status === null) return erroJson(409, "em_andamento", "Esta requisição ainda está sendo processada. Tente de novo em instantes.");
        const r = NextResponse.json(row.response, { status: row.status });
        r.headers.set("Idempotent-Replay", "true");
        return r;
      }
    }
    await tx.insert(s.idempotency).values({ familyId, key: chave, requestHash: hash });
    return null;
  });
}

export async function idemConcluir(familyId: string, chave: string, resp: NextResponse): Promise<void> {
  await withFamilia(familyId, async (tx) => {
    if (resp.status < 300) {
      await tx.update(s.idempotency).set({ status: resp.status, response: await resp.clone().json() }).where(and(eq(s.idempotency.familyId, familyId), eq(s.idempotency.key, chave)));
    } else {
      // erros não executaram nada: a repetição (corrigida) pode tentar de novo
      await tx.delete(s.idempotency).where(and(eq(s.idempotency.familyId, familyId), eq(s.idempotency.key, chave)));
    }
    // limpeza oportunista das respostas vencidas desta família
    await tx.delete(s.idempotency).where(and(eq(s.idempotency.familyId, familyId), lt(s.idempotency.createdAt, new Date(Date.now() - JANELA_IDEM_MS))));
  });
}

/* ------------------------------------------------------------------ entrada */

export async function lerEntrada(req: NextRequest): Promise<{ corpo: unknown; idemKey: string | null } | NextResponse> {
  let corpo: unknown;
  if (["POST", "PATCH", "PUT"].includes(req.method)) {
    const texto = await req.text();
    if (texto) {
      try {
        corpo = JSON.parse(texto);
      } catch {
        return erroJson(400, "json_invalido", "O corpo da requisição não é um JSON válido.");
      }
    }
  }
  const idemKey = ["POST", "PATCH"].includes(req.method) ? req.headers.get("idempotency-key") : null;
  if (idemKey !== null && !CHAVE_IDEM_RE.test(idemKey)) return erroJson(400, "idempotency_key_invalida", "Idempotency-Key deve ter de 1 a 200 caracteres ASCII visíveis.");
  return { corpo, idemKey };
}

export const telefoneDoCabecalho = (req: NextRequest): string => (req.headers.get("x-telefone") ?? "").replace(/\D/g, "");
export const telefoneValido = (t: string) => /^\d{10,15}$/.test(t);

export function tratarErro(e: unknown): NextResponse {
  if (e instanceof ApiError) return erroJson(e.status, e.codigo, e.message, e.detalhes);
  if (e instanceof ForbiddenError) return erroJson(403, "sem_permissao", "Seu perfil não tem permissão para fazer isso.");
  if (e instanceof UserError) return erroJson(422, "regra_de_negocio", e.message);
  if (e && typeof e === "object" && (e as { name?: string }).name === "ZodError") {
    const issues = (e as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    return erroJson(422, "invalido", "Dados inválidos.", { campos: issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })) });
  }
  console.error("[api] erro inesperado", (e as Error)?.name ?? "erro", (e as { code?: unknown })?.code ?? "");
  return erroJson(500, "erro_interno", "Erro interno. Tente novamente.");
}

export interface Contexto {
  actor: WaActor;
  req: NextRequest;
  corpo: unknown;
  params: Record<string, string>;
  /** Chamada vinda de chave de plataforma (N8N/simulador) ou de chave de família. */
  origem: "plataforma" | "familia";
  agora: Date;
}

/** Em rotas sem segmento dinâmico o Next (produção) pode não passar o contexto: o código usa `ctx?.params`. */
type ParamsCtx = { params: Promise<Record<string, string>> };

/** Auditoria de toda chamada com chave de plataforma (falha ao gravar não derruba a resposta). */
async function auditar(auth: Auth | null, req: NextRequest, resp: NextResponse, familiaId: string | null, telefone: string | null) {
  if (!auth || auth.tipo !== "plataforma") return;
  try {
    await auditarPlataforma({ chaveId: auth.chaveId, metodo: req.method, rota: req.nextUrl.pathname, familiaId, telefone, status: resp.status });
  } catch (e) {
    console.error("[api] auditoria da plataforma não gravada", (e as Error).name);
  }
}

/**
 * Rota que age em nome de um usuário (X-Telefone obrigatório). As permissões são as do ator; a regra mora nos mesmos
 * serviços do portal.
 */
export function rota<T>(
  fn: (c: Contexto) => Promise<NextResponse | T>,
  opts: { idempotente?: "sempre" | "se-enviada" } = {},
) {
  return async (req: NextRequest, ctx: ParamsCtx): Promise<NextResponse> => {
    let auth: Auth | null = null;
    let familiaAuditada: string | null = null;
    let telefone: string | null = null;
    const resp = await (async (): Promise<NextResponse> => {
      try {
        const a = await autenticar(req);
        if (a instanceof NextResponse) return a;
        auth = a;
        if (a.tipo === "plataforma" && !a.escopos.includes("conversa")) return erroJson(403, "escopo_insuficiente", 'Esta chave de plataforma não tem o escopo "conversa".');

        const entrada = await lerEntrada(req);
        if (entrada instanceof NextResponse) return entrada;
        const tel = telefoneDoCabecalho(req);
        telefone = tel || null;
        if (!telefoneValido(tel)) return erroJson(400, "telefone_obrigatorio", "Informe o telefone do usuário no cabeçalho X-Telefone (DDI + DDD + número, só dígitos).");
        const espera = limiteExcedido(`tel:${tel}`);
        if (espera) {
          const r = erroJson(429, "limite_excedido", "Muitas requisições para este telefone. Aguarde um pouco.");
          r.headers.set("Retry-After", String(espera));
          return r;
        }

        const actor = await resolveSender(tel);
        if (!actor || (a.tipo === "familia" && actor.familyId !== a.familiaId)) return erroJson(404, "nao_encontrado", MSG_TELEFONE);
        familiaAuditada = actor.familyId;

        const params = (await Promise.resolve(ctx?.params).catch(() => ({}))) ?? {};
        const idemKey = entrada.idemKey ?? (opts.idempotente === "sempre" ? `auto:${sha256(`${req.method}${req.nextUrl.pathname}${canonico(entrada.corpo)}`)}` : null);
        const hash = idemKey ? hashRequisicao(req, entrada.corpo) : "";
        if (idemKey) {
          const guardada = await idemIniciar(actor.familyId, idemKey, hash);
          if (guardada) return guardada;
        }
        let final: NextResponse;
        try {
          const out = await fn({ actor, req, corpo: entrada.corpo, params, origem: a.tipo, agora: new Date() });
          final = out instanceof NextResponse ? out : json(out);
        } catch (e) {
          final = tratarErro(e);
        }
        if (idemKey) await idemConcluir(actor.familyId, idemKey, final);
        return final;
      } catch (e) {
        return tratarErro(e);
      }
    })();
    await auditar(auth, req, resp, familiaAuditada, telefone);
    return resp;
  };
}

/**
 * Rota SEM usuário (fila de saída, saúde): chave de plataforma enxerga todas as famílias; chave de família só a dela.
 */
export function rotaFila<T>(
  fn: (c: { req: NextRequest; corpo: unknown; params: Record<string, string>; familiaId: string | null; agora: Date }) => Promise<NextResponse | T>,
  opts: { soPlataforma?: boolean } = {},
) {
  return async (req: NextRequest, ctx: ParamsCtx): Promise<NextResponse> => {
    let auth: Auth | null = null;
    let familiaAuditada: string | null = null;
    const resp = await (async (): Promise<NextResponse> => {
      try {
        const a = await autenticar(req);
        if (a instanceof NextResponse) return a;
        auth = a;
        if (a.tipo === "plataforma" && !a.escopos.includes("conversa")) return erroJson(403, "escopo_insuficiente", 'Esta chave de plataforma não tem o escopo "conversa".');
        if (opts.soPlataforma && a.tipo !== "plataforma") return erroJson(403, "proibido", "Esta rota exige a chave de plataforma (cpl_).");
        const espera = limiteExcedido(`chave:${a.chaveId ?? "sim"}`, Date.now(), 600);
        if (espera) return erroJson(429, "limite_excedido", "Muitas requisições. Aguarde um pouco.");
        const entrada = await lerEntrada(req);
        if (entrada instanceof NextResponse) return entrada;
        familiaAuditada = a.tipo === "familia" ? a.familiaId : null;
        const params = (await Promise.resolve(ctx?.params).catch(() => ({}))) ?? {};
        const out = await fn({ req, corpo: entrada.corpo, params, familiaId: a.tipo === "familia" ? a.familiaId : null, agora: new Date() });
        return out instanceof NextResponse ? out : json(out);
      } catch (e) {
        return tratarErro(e);
      }
    })();
    await auditar(auth, req, resp, familiaAuditada, null);
    return resp;
  };
}

/**
 * Rota "pré-membro": o remetente ainda não é (ou não é reconhecido como) membro. Só chave de plataforma.
 * Recebe o telefone do remetente real; nunca resolve família antes de provar o código.
 */
export function rotaRemetente(
  fn: (c: { telefone: string; corpo: unknown; agora: Date }) => Promise<{ resp: NextResponse; familiaId?: string | null }>,
) {
  return async (req: NextRequest, _ctx?: unknown): Promise<NextResponse> => {
    let auth: Auth | null = null;
    let familiaAuditada: string | null = null;
    let telefone: string | null = null;
    const resp = await (async (): Promise<NextResponse> => {
      try {
        const a = await autenticar(req);
        if (a instanceof NextResponse) return a;
        auth = a;
        if (a.tipo !== "plataforma") return erroJson(403, "proibido", 'Esta rota exige a chave de plataforma (cpl_) com o escopo "conversa".');
        if (!a.escopos.includes("conversa")) return erroJson(403, "escopo_insuficiente", 'Esta chave de plataforma não tem o escopo "conversa".');
        const entrada = await lerEntrada(req);
        if (entrada instanceof NextResponse) return entrada;
        const tel = telefoneDoCabecalho(req);
        telefone = tel || null;
        if (!telefoneValido(tel)) return erroJson(400, "telefone_obrigatorio", "Informe o remetente no cabeçalho X-Telefone (DDI + DDD + número, só dígitos).");
        const espera = limiteExcedido(`tel:${tel}`);
        if (espera) return erroJson(429, "limite_excedido", "Muitas requisições para este telefone. Aguarde um pouco.");
        const r = await fn({ telefone: tel, corpo: entrada.corpo, agora: new Date() });
        familiaAuditada = r.familiaId ?? null;
        return r.resp;
      } catch (e) {
        return tratarErro(e);
      }
    })();
    await auditar(auth, req, resp, familiaAuditada, telefone);
    return resp;
  };
}

/** Consulta (query string) → objeto simples para os schemas zod. */
export const consulta = (req: NextRequest) => Object.fromEntries(req.nextUrl.searchParams.entries());

export { autenticar as _autenticar };
