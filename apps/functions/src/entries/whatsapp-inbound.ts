import { handleWhatsappInbound } from "../inbound/handler";
import { createRuntime } from "../runtime";
import type { FnContext } from "./context";

/** Appwrite Function `whatsapp-inbound` — chamada pelo workflow N8N (assinada com HMAC). */
export default async ({ req, res }: FnContext) => {
  const rt = createRuntime();
  const out = await handleWhatsappInbound(rt.inbound, { rawBody: req.bodyText, headers: req.headers });
  return res.json(out.body, out.status);
};
