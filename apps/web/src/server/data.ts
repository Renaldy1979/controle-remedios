import "server-only";
import type { FamilyScopedDb } from "@medcuidar/db";
import { Query } from "node-appwrite";

export type R = Record<string, unknown> & { $id: string; $createdAt: string; $updatedAt: string };

export const str = (r: R | undefined, k: string): string => (r && r[k] != null ? String(r[k]) : "");
export const num = (r: R | undefined, k: string): number => Number(r?.[k] ?? 0);
export const strList = (r: R | undefined, k: string): string[] => (Array.isArray(r?.[k]) ? (r![k] as unknown[]).map(String) : []);

/** Lê uma coleção inteira da família (páginas de 100, cursor). Sempre pelo FamilyScopedDb. */
export async function listAll(db: FamilyScopedDb, collection: string, queries: string[] = [], max = 2000): Promise<R[]> {
  const out: R[] = [];
  let cursor: string | undefined;
  while (out.length < max) {
    const page = await db.list(collection, [...queries, Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])]);
    out.push(...(page.documents as unknown as R[]));
    if (page.documents.length < 100) break;
    cursor = page.documents[page.documents.length - 1]!.$id;
  }
  return out;
}

export async function audit(db: FamilyScopedDb, actorMemberId: string, action: string, entity: string, entityId: string, meta: Record<string, string | number | boolean | string[]> = {}): Promise<void> {
  // Auditoria: só ids e contagens, nunca texto clínico livre.
  await db.create("audit_log", { actor_member_id: actorMemberId, action, entity, entity_id: entityId, at: new Date().toISOString(), meta: JSON.stringify(meta) });
}

export function parseMeta(r: R): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(str(r, "meta") || "{}");
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
