/**
 * Token de sessão assinado (HMAC-SHA256) com Web Crypto: funciona no middleware (Edge) e no Node.
 * O token só diz QUEM é (familyId + memberId + validade); o que a pessoa pode fazer é lido
 * do banco a cada requisição (perfil e `active`), então revogar vale na hora.
 */
export interface SessionClaims {
  f: string; // familyId
  m: string; // memberId
  exp: number; // epoch seconds
}

export const SESSION_COOKIE = "mc_session";
export const SESSION_TTL_SEC = 30 * 24 * 3600;

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(claims: SessionClaims, secret: string): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<SessionClaims | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64(sig), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(unb64(body))) as SessionClaims;
    if (typeof claims.f !== "string" || typeof claims.m !== "string" || typeof claims.exp !== "number" || claims.exp < nowSec) return null;
    return claims;
  } catch {
    return null;
  }
}

/** HMAC-SHA256 em hexadecimal (assinatura das URLs curtas de arquivo). */
export async function hmacHex(payload: string, secret: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}
