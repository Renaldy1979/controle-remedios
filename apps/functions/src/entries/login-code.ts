import { requestLoginCode, verifyLoginCode } from "../login";
import { createRuntime } from "../runtime";
import type { FnContext } from "./context";

/**
 * Appwrite Function `login-code`.
 * POST /request {phone}        → sempre { ok: true }
 * POST /verify  {phone, code}  → { ok: true, token } | { ok: false }
 */
export default async ({ req, res }: FnContext) => {
  let body: { phone?: unknown; code?: unknown } = {};
  try {
    body = JSON.parse(req.bodyText || "{}");
  } catch {
    return res.json({ ok: false }, 400);
  }
  if (typeof body.phone !== "string") return res.json({ ok: false }, 400);
  const rt = createRuntime();
  if (req.path?.endsWith("/verify")) {
    const out = await verifyLoginCode(rt.login, body.phone, typeof body.code === "string" ? body.code : "");
    return res.json(out, out.ok ? 200 : 401);
  }
  return res.json(await requestLoginCode(rt.login, body.phone));
};
