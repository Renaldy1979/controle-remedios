import type { ConfirmDoseRepo, DoseEvent, StockMovement, UndoDoseRepo } from "@medcuidar/domain";
import type { FamilyData, Row } from "../ports";
import { isConflict, n, s } from "../rows";
import { clean, toDose, toMovement } from "./mappers";

/** Outra mensagem já confirmou uma dose com o mesmo `source_message_id` (índice único, HTTP 409). */
export class DuplicateSourceMessageError extends Error {
  constructor() {
    super("source_message_id duplicado");
    this.name = "DuplicateSourceMessageError";
  }
}

const PAGE = 100;

/** Soma o livro-razão de um item (saldo = soma de `quantity`), paginando. */
export async function ledgerBalance(data: FamilyData, stockItemId: string): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await data.find("stock_movements", { stock_item_id: stockItemId }, { limit: PAGE, offset, orderBy: "$createdAt" });
    total += rows.reduce((a, r) => a + n(r, "quantity"), 0);
    if (rows.length < PAGE) break;
  }
  return Math.round(total * 1000) / 1000;
}

/** `cached_balance` é só otimização: recalcula a partir do livro-razão. */
export async function refreshCachedBalance(data: FamilyData, stockItemId: string, now: Date): Promise<number> {
  const balance = await ledgerBalance(data, stockItemId);
  await data.update("stock_items", stockItemId, { cached_balance: balance, cached_balance_at: now.toISOString() });
  return balance;
}

/** Repositório fino de doses/estoque sobre `FamilyData` (que é `FamilyScopedDb` em produção). */
export class DoseRepo implements ConfirmDoseRepo, UndoDoseRepo {
  constructor(
    private readonly data: FamilyData,
    private readonly now: () => Date,
  ) {}

  /** Itens de estoque tocados, para recalcular o saldo em cache depois. */
  readonly touchedItems = new Set<string>();

  async getDose(id: string): Promise<DoseEvent | null> {
    const row = await this.data.getOrNull("dose_events", id);
    return row ? toDose(row) : null;
  }

  async findDoseBySourceMessage(sourceMessageId: string): Promise<DoseEvent | null> {
    const [row] = await this.data.find("dose_events", { source_message_id: sourceMessageId }, { limit: 1 });
    return row ? toDose(row) : null;
  }

  async findStockItemId(patientId: string, medicationId: string): Promise<string | null> {
    const [row] = await this.data.find("stock_items", { patient_id: patientId, medication_id: medicationId }, { limit: 1 });
    return row?.$id ?? null;
  }

  /**
   * Movimento original da dose (índice único `dose_event_id`) + compensações `undo:/redo:<doseId>`.
   * Sem o original não pode haver compensação, então a busca nas notas só acontece se ele existir,
   * e para ao encontrá-lo (as compensações são sempre mais novas).
   */
  async listDoseMovements(doseId: string): Promise<StockMovement[]> {
    const [original] = await this.data.find("stock_movements", { dose_event_id: doseId }, { limit: 1 });
    if (!original) return [];
    const out: StockMovement[] = [toMovement(original)];
    const itemId = s(original, "stock_item_id");
    const prefixes = [`undo:${doseId}`, `redo:${doseId}`];
    for (let offset = 0; ; offset += PAGE) {
      const rows = await this.data.find("stock_movements", { stock_item_id: itemId }, { limit: PAGE, offset, orderBy: "$createdAt", order: "desc" });
      let reachedOriginal = false;
      for (const r of rows) {
        if (r.$id === original.$id) reachedOriginal = true;
        else if (prefixes.some((p) => s(r, "note").startsWith(p))) out.push(toMovement(r));
      }
      if (reachedOriginal || rows.length < PAGE) break;
    }
    return out;
  }

  async insertMovement(movement: StockMovement): Promise<void> {
    const { id: _id, ...rest } = movement;
    void _id;
    await this.data.create("stock_movements", clean({ ...rest, dose_event_id: rest.dose_event_id ?? undefined, replenishment_id: rest.replenishment_id ?? undefined, note: rest.note ?? undefined }));
    this.touchedItems.add(movement.stock_item_id);
  }

  async insertDoseMovementIfAbsent(movement: StockMovement): Promise<boolean> {
    try {
      await this.insertMovement(movement);
      return true;
    } catch (e) {
      if (isConflict(e)) return false; // outro processo já descontou esta dose
      throw e;
    }
  }

  async markTaken(
    doseId: string,
    patch: { confirmed_by_member_id: string; confirmed_at: string; channel: "whatsapp" | "panel" | "system"; source_message_id?: string | null },
  ): Promise<DoseEvent> {
    try {
      const row = await this.data.update("dose_events", doseId, clean({ status: "taken", ...patch, source_message_id: patch.source_message_id ?? undefined }));
      return toDose(row as Row);
    } catch (e) {
      if (isConflict(e)) throw new DuplicateSourceMessageError();
      throw e;
    }
  }

  async resetDose(doseId: string, status: "pending" | "late" | "missed"): Promise<DoseEvent> {
    const row = await this.data.update("dose_events", doseId, {
      status, confirmed_by_member_id: null, confirmed_at: null, channel: null, source_message_id: null,
    });
    return toDose(row);
  }

  async flushBalances(): Promise<void> {
    for (const id of this.touchedItems) await refreshCachedBalance(this.data, id, this.now());
    this.touchedItems.clear();
  }
}
