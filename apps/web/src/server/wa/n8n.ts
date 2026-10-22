import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { eq } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { fileUrlSecret } from "../env";
import { UserError } from "../pg/errors";

/**
 * Integração com o N8N (Lote 4B): URL do webhook do fluxo `05-teste-conexao`, segredo do teste (HMAC) e o botão "Testar conexão".
 * Padrão do projeto controle-financeiro (`packages/core/src/webhook.ts`): URL validada contra SSRF, POST assinado, timeout curto,
 * sem seguir redirects, mensagens amigáveis por tipo de falha.
 */

/** Cabeçalhos enviados ao N8N. O N8N confere o segredo pela credencial Header Auth do webhook; a assinatura cobre o corpo. */
export const CABECALHO_TOKEN = "X-MedCuidar-Token";
export const CABECALHO_ASSINATURA = "X-MedCuidar-Assinatura";
export const CABECALHO_TIMESTAMP = "X-MedCuidar-Timestamp";

/** Só testes: libera localhost/rede privada para falar com um servidor falso. Recusado com APP_ENV=production. */
export const allowPrivateWebhooks = (): boolean => process.env["ALLOW_PRIVATE_WEBHOOKS"] === "1" && process.env["APP_ENV"] !== "production";

/** IPs que o servidor nunca deve chamar a pedido do usuário (rede interna, loopback, metadados de nuvem). */
export function ipPrivado(ip: string): boolean {
  let a = ip.toLowerCase();
  // IPv4 mapeado em IPv6: `::ffff:127.0.0.1` ou, já normalizado pelo URL(), `::ffff:7f00:1`
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a);
  if (hex) {
    const n = (parseInt(hex[1]!, 16) << 16) + parseInt(hex[2]!, 16);
    a = [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  } else if (a.startsWith("::ffff:")) a = a.slice(7);
  if (isIP(a) === 4) {
    const [x, y] = a.split(".").map(Number) as [number, number];
    return x === 0 || x === 10 || x === 127 || x >= 224
      || (x === 100 && y >= 64 && y <= 127)
      || (x === 169 && y === 254)
      || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168);
  }
  return a === "::" || a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9")
    || a.startsWith("fea") || a.startsWith("feb") || a.startsWith("ff");
}

/** Valida a URL: só https, sem usuário/senha, sem host interno, DNS resolvido (nomes que apontam para a rede interna são barrados). */
export async function validarUrlWebhook(url: string, opcoes: { permitirPrivada?: boolean } = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new UserError("Informe uma URL válida (https://…).");
  }
  if (u.username || u.password) throw new UserError("A URL não pode ter usuário e senha.");
  if (u.protocol !== "https:" && !(opcoes.permitirPrivada && u.protocol === "http:")) throw new UserError("Use uma URL https:// para o webhook do N8N.");
  if (opcoes.permitirPrivada) return u;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal"))
    throw new UserError("Essa URL não é permitida. Use o endereço público do seu N8N.");
  const ips = isIP(h) ? [h] : await lookup(h, { all: true }).then((r) => r.map((x) => x.address)).catch(() => {
    throw new UserError("Não encontramos esse endereço. Confira a URL do N8N.");
  });
  if (ips.length === 0 || ips.some(ipPrivado)) throw new UserError("Essa URL não é permitida. Use o endereço público do seu N8N.");
  return u;
}

export const assinarWebhook = (segredo: string, timestamp: string, corpo: string): string =>
  `sha256=${createHmac("sha256", segredo).update(`${timestamp}.${corpo}`).digest("hex")}`;

export type ResultadoTeste = { ok: true; ms: number; versao: string | null } | { ok: false; erro: string };

/**
 * POST assinado no webhook do fluxo 05. Timeout de 5 s, sem seguir redirecionamento (um 30x poderia levar à rede interna).
 * Espera 2xx; se o corpo for `{ ok: true, versao }` devolve a versão.
 */
export async function testarConexaoWebhook(entrada: { url: string; segredo: string; timeoutMs?: number; permitirPrivada?: boolean; agora?: Date }): Promise<ResultadoTeste> {
  let alvo: URL;
  try {
    alvo = await validarUrlWebhook(entrada.url, { permitirPrivada: entrada.permitirPrivada });
  } catch (e) {
    return { ok: false, erro: e instanceof UserError ? e.message : "URL inválida." };
  }
  const agora = entrada.agora ?? new Date();
  const corpo = JSON.stringify({ evento: "teste_conexao", origem: "medcuidar", em: agora.toISOString() });
  const ts = String(Math.floor(agora.getTime() / 1000));
  const inicio = Date.now();
  try {
    const r = await fetch(alvo, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(entrada.timeoutMs ?? 5000),
      headers: {
        "Content-Type": "application/json", [CABECALHO_TOKEN]: entrada.segredo, [CABECALHO_TIMESTAMP]: ts,
        [CABECALHO_ASSINATURA]: assinarWebhook(entrada.segredo, ts, corpo),
      },
      body: corpo,
    });
    const ms = Date.now() - inicio;
    if (r.status >= 300 && r.status < 400) return { ok: false, erro: "O endereço redirecionou para outro lugar. Use a URL final (de produção) do webhook do N8N." };
    if (r.status === 401 || r.status === 403) return { ok: false, erro: "O N8N recusou o segredo. Confira se a credencial “MedCuidar Teste de conexão” tem o mesmo segredo gerado aqui." };
    if (r.status === 404) return { ok: false, erro: "Webhook não encontrado. Confira a URL e se o fluxo 05 está ativo (use a URL de produção, não a de teste)." };
    if (!r.ok) return { ok: false, erro: `O N8N respondeu com o código ${r.status}. Confira se o fluxo 05 está ativo.` };
    const dados = (await r.json().catch(() => null)) as { ok?: unknown; versao?: unknown } | null;
    if (dados && dados.ok === false) return { ok: false, erro: "O N8N respondeu, mas recusou o teste. Confira o segredo." };
    return { ok: true, ms, versao: typeof dados?.versao === "string" ? dados.versao : null };
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") return { ok: false, erro: "O N8N demorou demais para responder (mais de 5 segundos). Confira se está no ar." };
    return { ok: false, erro: "Não foi possível conectar. Confira a URL e se o N8N está no ar." };
  }
}

/* ------------------------------------------------------------------ segredo cifrado no banco */

const chaveCifra = (): Buffer => createHash("sha256").update(`n8n-secret:${fileUrlSecret()}`).digest();

export function cifrarSegredo(claro: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chaveCifra(), iv);
  const dado = Buffer.concat([c.update(claro, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${dado.toString("base64url")}`;
}

export function decifrarSegredo(cifrado: string): string | null {
  const [v, iv, tag, dado] = cifrado.split(".");
  if (v !== "v1" || !iv || !tag || !dado) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", chaveCifra(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dado, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const gerarSegredoN8n = (): string => `whsec_${randomBytes(24).toString("hex")}`;

/* ------------------------------------------------------------------ configuração por família */

export interface EstadoN8n {
  url: string | null;
  temSegredo: boolean;
  teste: { em: Date; ok: boolean; versao: string | null } | null;
  /** aguardando = nenhum teste OK ainda; conectado = o último teste passou */
  estado: "aguardando" | "conectado";
}

export async function lerEstadoN8n(familyId: string): Promise<EstadoN8n> {
  const [r] = await withFamilia(familyId, (tx) => tx.select().from(s.familyIntegrations).where(eq(s.familyIntegrations.familyId, familyId)));
  const teste = r?.n8nCheckedAt ? { em: r.n8nCheckedAt, ok: r.n8nCheckOk === true, versao: r.n8nVersion } : null;
  return { url: r?.n8nWebhookUrl ?? null, temSegredo: !!r?.n8nSecretEnc, teste, estado: teste?.ok ? "conectado" : "aguardando" };
}

async function gravar(familyId: string, campos: Partial<typeof s.familyIntegrations.$inferInsert>): Promise<void> {
  await withFamilia(familyId, (tx) =>
    tx.insert(s.familyIntegrations).values({ familyId, ...campos })
      .onConflictDoUpdate({ target: s.familyIntegrations.familyId, set: { ...campos, updatedAt: new Date() } }));
}

/** Valida (https, sem rede interna, DNS) e guarda a URL; o resultado do último teste é apagado. */
export async function salvarUrlN8n(familyId: string, url: string): Promise<string> {
  const u = await validarUrlWebhook(url, { permitirPrivada: allowPrivateWebhooks() });
  await gravar(familyId, { n8nWebhookUrl: u.toString(), n8nCheckedAt: null, n8nCheckOk: null, n8nVersion: null });
  return u.toString();
}

/** Gera (ou troca) o segredo do teste. Devolve o valor em claro UMA vez; no banco fica cifrado. */
export async function gerarSegredoDoTeste(familyId: string): Promise<string> {
  const segredo = gerarSegredoN8n();
  await gravar(familyId, { n8nSecretEnc: cifrarSegredo(segredo), n8nCheckedAt: null, n8nCheckOk: null, n8nVersion: null });
  return segredo;
}

export async function testarN8n(familyId: string): Promise<{ resultado: ResultadoTeste; estado: EstadoN8n }> {
  const [r] = await withFamilia(familyId, (tx) => tx.select().from(s.familyIntegrations).where(eq(s.familyIntegrations.familyId, familyId)));
  if (!r?.n8nWebhookUrl) throw new UserError("Salve a URL do webhook do N8N antes de testar.");
  const segredo = r.n8nSecretEnc ? decifrarSegredo(r.n8nSecretEnc) : null;
  if (!segredo) throw new UserError("Gere o segredo e crie a credencial no N8N antes de testar.");
  const resultado = await testarConexaoWebhook({ url: r.n8nWebhookUrl, segredo, timeoutMs: 5000, permitirPrivada: allowPrivateWebhooks() });
  await gravar(familyId, { n8nCheckedAt: new Date(), n8nCheckOk: resultado.ok, n8nVersion: resultado.ok ? resultado.versao : null });
  return { resultado, estado: await lerEstadoN8n(familyId) };
}
