import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { can } from "@medcuidar/shared";
import type { NoticeVM } from "@/data/types";
import type { Actor } from "./guard";
import { stampLabel } from "./stamp";

const LIMIT = 30;

/** Avisos do sino da PESSOA logada (o RLS isola a família; aqui filtramos também pelo membro). */
export async function listNotices(actor: Actor, now: Date = new Date()): Promise<{ notices: NoticeVM[]; unread: number }> {
  return withFamilia(actor.familyId, async (tx) => {
    const mine = eq(s.notifications.memberId, actor.memberId);
    const rows = await tx.select().from(s.notifications).where(mine).orderBy(desc(s.notifications.createdAt), desc(s.notifications.id)).limit(LIMIT);
    const [u] = await tx.select({ n: sql<number>`count(*)::int` }).from(s.notifications).where(and(mine, isNull(s.notifications.readAt)));
    const canStock = can(actor.member, "stock.view");
    const notices = rows.map((r): NoticeVM => {
      const med = typeof r.payload["medicationId"] === "string" ? (r.payload["medicationId"] as string) : "";
      const sameDay = stampLabel(r.createdAt, actor.timezone).slice(0, 10) === stampLabel(now, actor.timezone).slice(0, 10);
      const label = stampLabel(r.createdAt, actor.timezone);
      return {
        id: r.id,
        kind: r.kind,
        title: r.title,
        body: r.body ?? "",
        whenLabel: sameDay ? `hoje às ${label.slice(-5)}` : label.replace(/\/\d{4}/, ""),
        read: r.readAt !== null,
        href: r.kind === "low_stock" && canStock ? `/configuracoes/estoque${med ? `?med=${med}` : ""}` : "/",
      };
    });
    return { notices, unread: u?.n ?? 0 };
  });
}

/** Marca como lidos os avisos da pessoa (sem ids = todos). Nunca mexe nos avisos de outra pessoa. */
export async function markNoticesRead(actor: Actor, ids?: string[], now: Date = new Date()): Promise<void> {
  await withFamilia(actor.familyId, async (tx) => {
    const where = [eq(s.notifications.memberId, actor.memberId), isNull(s.notifications.readAt)];
    if (ids) {
      if (ids.length === 0) return;
      where.push(inArray(s.notifications.id, ids));
    }
    await tx.update(s.notifications).set({ readAt: now }).where(and(...where));
  });
}
