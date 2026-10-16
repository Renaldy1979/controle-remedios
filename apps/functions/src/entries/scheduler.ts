import { timingSafeEqual } from "node:crypto";
import { processOutbox } from "../outbox";
import { createRuntime } from "../runtime";
import { runSchedulerTick } from "../scheduler";
import type { FnContext } from "./context";

function secretMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Appwrite Function `scheduler` — cron `* * * * *`. Roda o agendador e em seguida esvazia a outbox.
 * Chamadas HTTP (ex.: workflow N8N de reserva) precisam do segredo `SCHEDULER_TRIGGER_SECRET`;
 * a execução agendada pelo próprio Appwrite não precisa.
 */
export default async ({ req, res }: FnContext) => {
  const scheduled = req.headers["x-appwrite-trigger"] === "schedule";
  if (!scheduled && !secretMatches(req.headers["x-medcuidar-secret"], process.env["SCHEDULER_TRIGGER_SECRET"])) {
    return res.json({ ok: false }, 401);
  }
  const rt = createRuntime();
  const now = new Date();
  const tick = await runSchedulerTick(rt.scheduler, now);
  const outbox = await processOutbox(rt.outbox, now);
  return res.json({ ok: true, tick, outbox });
};
