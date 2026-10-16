import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { normalizePhone, phoneVariants, type TemplateParams } from "@medcuidar/channels";
import { enqueue } from "./outbox";
import type { AuthPort, DataFactory, GlobalData, Logger, RateLimiter, Row } from "./ports";
import { s, sOpt } from "./rows";
import { seal } from "./seal";

export interface LoginConfig {
  ttlMin: number;
  maxAttempts: number;
  /** Intervalo mínimo entre dois envios ao mesmo telefone. */
  minIntervalSec: number;
  maxPerHour: number;
}

export const DEFAULT_LOGIN_CONFIG: LoginConfig = { ttlMin: 10, maxAttempts: 5, minIntervalSec: 60, maxPerHour: 5 };

export interface LoginDeps {
  global: GlobalData;
  dataFor: DataFactory;
  auth: AuthPort;
  limiter: RateLimiter;
  /** Pimenta do hash do código (só o hash é gravado). */
  hashSecret: string;
  /** Segredo para selar o código na outbox até o envio. */
  sealSecret: string;
  log: Logger;
  now: () => Date;
  flush?: (familyId: string) => Promise<void>;
  config?: Partial<LoginConfig>;
}

export const hashCode = (phone: string, code: string, secret: string) =>
  createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");

async function findMember(deps: LoginDeps, rawPhone: string): Promise<{ familyId: string; member: Row; phone: string } | null> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return null;
  const variants = phoneVariants(normalized);
  for (const family of await deps.global.listFamilies()) {
    const [member] = await deps.dataFor(family.id).find("members", { phone_e164: { in: variants }, active: true }, { limit: 1 });
    const phone = member ? sOpt(member, "phone_e164") : undefined;
    if (member && phone) return { familyId: family.id, member, phone };
  }
  return null;
}

/**
 * Pede o código. A resposta é SEMPRE a mesma (`ok: true`), exista o número ou não,
 * esteja limitado ou não, para não revelar quem é cadastrado.
 */
export async function requestLoginCode(deps: LoginDeps, rawPhone: string): Promise<{ ok: true }> {
  const cfg = { ...DEFAULT_LOGIN_CONFIG, ...deps.config };
  const now = deps.now();
  const normalized = normalizePhone(rawPhone);
  if (!normalized || !deps.limiter.allow(`login-req:${normalized}`, now)) return { ok: true };
  const found = await findMember(deps, rawPhone);
  if (!found) return { ok: true };

  const previous = await deps.global.findLoginCodes(found.phone);
  const createdAt = (r: Row) => new Date(String(r.$createdAt ?? 0)).getTime();
  const latest = previous.reduce((max, r) => Math.max(max, createdAt(r)), 0);
  if (now.getTime() - latest < cfg.minIntervalSec * 1000) return { ok: true };
  if (previous.filter((r) => now.getTime() - createdAt(r) < 3_600_000).length >= cfg.maxPerHour) return { ok: true };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const doc = await deps.global.createLoginCode({
    phone_e164: found.phone,
    code_hash: hashCode(found.phone, code, deps.hashSecret),
    expires_at: new Date(now.getTime() + cfg.ttlMin * 60_000).toISOString(),
    attempts: 0,
  });
  await enqueue(
    deps.dataFor(found.familyId),
    {
      kind: "login_code",
      template: "login_code",
      // O código não fica em claro na outbox: selado até o envio e zerado depois.
      params: { sealed: seal(code, deps.sealSecret), minutes: cfg.ttlMin } as unknown as TemplateParams["login_code"],
      targetMemberId: found.member.$id,
      dedupeKey: `login:${doc.$id}`,
    },
    now,
  );
  try {
    await deps.flush?.(found.familyId);
  } catch {
    /* o cron entrega */
  }
  return { ok: true };
}

export type VerifyResult = { ok: true; token: string } | { ok: false };

/** Valida o código. Falha sempre devolve o mesmo `{ ok: false }`. */
export async function verifyLoginCode(deps: LoginDeps, rawPhone: string, code: string): Promise<VerifyResult> {
  const cfg = { ...DEFAULT_LOGIN_CONFIG, ...deps.config };
  const now = deps.now();
  const normalized = normalizePhone(rawPhone);
  if (!normalized || !/^\d{6}$/.test(code)) return { ok: false };
  if (!deps.limiter.allow(`login-verify:${normalized}`, now)) return { ok: false };
  const found = await findMember(deps, rawPhone);
  if (!found) return { ok: false };

  const codes = await deps.global.findLoginCodes(found.phone);
  const active = codes.find((r) => !sOpt(r, "consumed_at") && new Date(s(r, "expires_at")) > now);
  if (!active) return { ok: false };
  const attempts = Number(active["attempts"] ?? 0);
  if (attempts >= cfg.maxAttempts) return { ok: false };

  const expected = Buffer.from(s(active, "code_hash"));
  const given = Buffer.from(hashCode(found.phone, code, deps.hashSecret));
  const match = expected.length === given.length && timingSafeEqual(expected, given);
  if (!match) {
    const next = attempts + 1;
    await deps.global.updateLoginCode(active.$id, { attempts: next, ...(next >= cfg.maxAttempts ? { consumed_at: now.toISOString() } : {}) });
    deps.log.warn("login.wrong_code");
    return { ok: false };
  }
  await deps.global.updateLoginCode(active.$id, { consumed_at: now.toISOString() }); // uso único
  const session = await deps.auth.createSessionFor(found.phone);
  return session ? { ok: true, token: session.token } : { ok: false };
}
