import {
  advanceReplenishment,
  applyAdjustment,
  prescriptionsToSupersede,
  purchaseQuantity,
  undoDoseConfirmation,
  type AdvanceResult,
  type UndoDoseResult,
} from "@medcuidar/domain";
import type { ChannelAdapter } from "@medcuidar/channels";
import type { FileSigner } from "./domain/binding";
import { dateOnly } from "./domain/mappers";
import { ledgerBalance, refreshCachedBalance } from "./domain/repo";
import { loadReplenishment, saveReplenishment } from "./domain/replenishment-repo";
import { enqueue } from "./outbox";
import type { LoginDeps } from "./login";
import { requestLoginCode, verifyLoginCode, type VerifyResult } from "./login";
import type { ConfirmDoseInput, ConfirmDoseResult, DataFactory, DomainPort, GlobalData, LowStockAlert } from "./ports";
import { s } from "./rows";

export interface ServiceDeps {
  global: GlobalData;
  dataFor: DataFactory;
  domain: DomainPort & { repoFor(familyId: string): import("./domain/repo").DoseRepo };
  channel: ChannelAdapter;
  login: LoginDeps;
  signer?: FileSigner;
  now?: () => Date;
}

export interface SavePrescriptionInput {
  familyId: string;
  memberId: string;
  patientId: string;
  /** YYYY-MM-DD */
  issuedOn: string;
  validUntil?: string;
  doctorName?: string;
  specialty?: string;
  isControlled?: boolean;
  copies?: number;
  notes?: string;
  medicationIds: string[];
  /** Arquivos já enviados ao Storage (o upload resiliente é do painel). */
  files: Array<{ storageFileId: string; page: number; mime: string; size: number }>;
}

/**
 * API de serviços para o painel (server-side): as mesmas regras que o WhatsApp usa, sem duplicar lógica.
 * Todo acesso a dados passa por `FamilyScopedDb` via `dataFor(familyId)`.
 */
export function buildServices(deps: ServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const { domain } = deps;

  const familySettings = async (familyId: string) => (await deps.global.listFamilies()).find((f) => f.id === familyId)?.settings;
  const audit = (familyId: string, memberId: string, action: string, entity: string, entityId: string, meta: Record<string, unknown> = {}) =>
    deps.dataFor(familyId).create("audit_log", { actor_member_id: memberId, action, entity, entity_id: entityId, at: now().toISOString(), meta: JSON.stringify(meta) });

  return {
    domain,
    channel: deps.channel,
    dataFor: deps.dataFor,

    /** Login por código no WhatsApp: pedir (resposta sempre igual) e verificar (abre sessão do Appwrite). */
    login: {
      requestCode: (phone: string) => requestLoginCode(deps.login, phone),
      verifyCode: (phone: string, code: string): Promise<VerifyResult> => verifyLoginCode(deps.login, phone, code),
    },

    doses: {
      /** Confirma (painel/WhatsApp/sistema). Idempotente por dose e por `sourceMessageId`. Já devolve o aviso de estoque, se cruzou o limite. */
      async confirm(input: ConfirmDoseInput): Promise<{ result: ConfirmDoseResult; lowStock: LowStockAlert[] }> {
        const result = await domain.confirmDose(input);
        const lowStock =
          result.outcome === "confirmed"
            ? await domain.checkLowStock({ familyId: input.familyId, ...(result.patientId ? { patientId: result.patientId } : {}), ...(result.medicationId ? { medicationId: result.medicationId } : {}) })
            : [];
        return { result, lowStock };
      },

      /** Desfazer (o prazo de 8 s é da interface). Devolve o estoque com um movimento `adjustment`. */
      async undo(input: { familyId: string; doseEventId: string; memberId: string }): Promise<UndoDoseResult> {
        const repo = domain.repoFor(input.familyId);
        const res = await undoDoseConfirmation(repo, {
          doseId: input.doseEventId, memberId: input.memberId, now: now(), ...(await familySettings(input.familyId).then((st) => (st ? { settings: st } : {}))),
        });
        await repo.flushBalances();
        return res;
      },
    },

    stock: {
      balance: (familyId: string, stockItemId: string) => ledgerBalance(deps.dataFor(familyId), stockItemId),

      /** Ajuste manual: vira movimento `adjustment` com a diferença, nunca sobrescreve o saldo. */
      async adjust(input: { familyId: string; stockItemId: string; newBalance: number; memberId: string; note?: string }) {
        const data = deps.dataFor(input.familyId);
        const current = await ledgerBalance(data, input.stockItemId);
        const movement = applyAdjustment([{ quantity: current }], {
          familyId: input.familyId, stockItemId: input.stockItemId, newBalance: input.newBalance, memberId: input.memberId, ...(input.note ? { note: input.note } : {}),
        });
        if (movement) {
          await data.create("stock_movements", { stock_item_id: movement.stock_item_id, type: "adjustment", quantity: movement.quantity, created_by_member_id: input.memberId, ...(movement.note ? { note: movement.note } : {}) });
          await audit(input.familyId, input.memberId, "stock.adjust", "stock_item", input.stockItemId, { delta: movement.quantity });
        }
        return { movement, balance: await refreshCachedBalance(data, input.stockItemId, now()) };
      },

      /** Compra registrada: movimento `purchase` (+). */
      async registerPurchase(input: { familyId: string; stockItemId: string; quantity: number; memberId: string; replenishmentId?: string; note?: string }) {
        if (!(input.quantity > 0)) throw new Error("Quantidade de compra inválida");
        const data = deps.dataFor(input.familyId);
        await data.create("stock_movements", {
          stock_item_id: input.stockItemId, type: "purchase", quantity: input.quantity, created_by_member_id: input.memberId,
          ...(input.replenishmentId ? { replenishment_id: input.replenishmentId } : {}), ...(input.note ? { note: input.note } : {}),
        });
        return { balance: await refreshCachedBalance(data, input.stockItemId, now()) };
      },
    },

    replenishment: {
      /** "Eu cuido disso" (ou "Assumir no lugar" com `takeOver`). */
      async claim(input: { familyId: string; replenishmentId: string; memberId: string; takeOver?: boolean }): Promise<AdvanceResult | { ok: false; reason: "not_found" }> {
        const data = deps.dataFor(input.familyId);
        const loaded = await loadReplenishment(data, input.replenishmentId);
        if (!loaded) return { ok: false, reason: "not_found" };
        const res = advanceReplenishment(loaded.repl, { type: "claim", memberId: input.memberId, now: now(), ...(input.takeOver ? { takeOver: true } : {}) });
        if (res.ok && res.replenishment !== loaded.repl) await saveReplenishment(data, loaded, res.replenishment);
        return res;
      },

      /** Conclui a etapa atual ou cancela. Ao fechar ("Estoque atualizado") soma a compra ao estoque. */
      async advance(input: {
        familyId: string; replenishmentId: string; memberId: string;
        action: "complete" | "cancel"; note?: string; prescriptionId?: string; purchaseQuantity?: number;
      }): Promise<AdvanceResult | { ok: false; reason: "not_found" }> {
        const data = deps.dataFor(input.familyId);
        const loaded = await loadReplenishment(data, input.replenishmentId);
        if (!loaded) return { ok: false, reason: "not_found" };
        const at = now();
        const res = advanceReplenishment(
          loaded.repl,
          input.action === "cancel"
            ? { type: "cancel", memberId: input.memberId, now: at }
            : { type: "complete", memberId: input.memberId, now: at, ...(input.note ? { note: input.note } : {}), ...(input.prescriptionId ? { prescriptionId: input.prescriptionId } : {}), ...(input.purchaseQuantity !== undefined ? { purchaseQuantity: input.purchaseQuantity } : {}) },
        );
        if (!res.ok) return res;
        await saveReplenishment(data, loaded, res.replenishment);
        if (res.replenishment.status === "done" && loaded.repl.status !== "done") {
          const qty = purchaseQuantity(res.replenishment);
          const [item] = await data.find("stock_items", { patient_id: loaded.patientId, medication_id: loaded.medicationId }, { limit: 1 });
          if (item && qty > 0) {
            await data.create("stock_movements", { stock_item_id: item.$id, type: "purchase", quantity: qty, replenishment_id: input.replenishmentId, created_by_member_id: input.memberId });
            await refreshCachedBalance(data, item.$id, at);
          }
        }
        return res;
      },
    },

    prescriptions: {
      /**
       * Salva receita nova: grava receita, itens e arquivos; marca como substituídas as vencidas/aguardando do mesmo
       * paciente com remédio em comum; e avança as reposições abertas desses remédios para "receita recebida".
       */
      async save(input: SavePrescriptionInput): Promise<{ prescriptionId: string; superseded: string[]; replenishmentsAdvanced: string[] }> {
        if (input.medicationIds.length === 0) throw new Error("Informe ao menos um remédio");
        const data = deps.dataFor(input.familyId);
        const at = now();
        const rx = await data.create("prescriptions", {
          patient_id: input.patientId, issued_on: input.issuedOn, status: "valid", uploaded_by_member_id: input.memberId,
          ...(input.validUntil ? { valid_until: input.validUntil } : {}), ...(input.doctorName ? { doctor_name: input.doctorName } : {}),
          ...(input.specialty ? { specialty: input.specialty } : {}), ...(input.isControlled !== undefined ? { is_controlled: input.isControlled } : {}),
          ...(input.copies !== undefined ? { copies: input.copies } : {}), ...(input.notes ? { notes: input.notes } : {}),
        });
        for (const medication_id of input.medicationIds) await data.create("prescription_items", { prescription_id: rx.$id, medication_id });
        for (const f of input.files) await data.create("prescription_files", { prescription_id: rx.$id, storage_file_id: f.storageFileId, page: f.page, mime: f.mime, size: f.size });

        const others = await data.find("prescriptions", { patient_id: input.patientId }, { limit: 200 });
        const refs = [];
        for (const o of others.filter((x) => x.$id !== rx.$id)) {
          const items = await data.find("prescription_items", { prescription_id: o.$id }, { limit: 50 });
          refs.push({ id: o.$id, patient_id: input.patientId, status: s(o, "status") as "valid" | "expired" | "awaiting_new" | "superseded", medication_ids: items.map((i) => s(i, "medication_id")), valid_until: o["valid_until"] ? dateOnly(o["valid_until"]) : null });
        }
        // Vencidas pela data também contam como vencidas, mesmo que o status gravado ainda seja "valid".
        const today = at.toISOString().slice(0, 10);
        const normalized = refs.map((r) => (r.status === "valid" && r.valid_until && r.valid_until < today ? { ...r, status: "expired" as const } : r));
        const superseded = prescriptionsToSupersede({ id: rx.$id, patient_id: input.patientId, medication_ids: input.medicationIds }, normalized);
        for (const id of superseded) await data.update("prescriptions", id, { status: "superseded", superseded_by_id: rx.$id });

        const advanced: string[] = [];
        for (const medicationId of input.medicationIds) {
          const open = await data.find("replenishments", { patient_id: input.patientId, medication_id: medicationId, status: "needs_prescription" }, { limit: 5 });
          for (const r of open) {
            const loaded = await loadReplenishment(data, r.$id);
            if (!loaded) continue;
            let next = loaded.repl;
            for (const step of [1, 2] as const) {
              const cur = next.steps.find((x) => x.step === step)!;
              if (cur.done_at) continue;
              next = { ...next, steps: next.steps.map((x) => (x.step === step ? { ...x, done_at: at.toISOString(), prescription_id: rx.$id } : x)) };
            }
            next = { ...next, status: "prescription_received" };
            await saveReplenishment(data, loaded, next);
            advanced.push(r.$id);
          }
        }
        await audit(input.familyId, input.memberId, "prescription.create", "prescription", rx.$id, { superseded: superseded.length });
        return { prescriptionId: rx.$id, superseded, replenishmentsAdvanced: advanced };
      },

      /** Registro de visualização (auditoria de acesso). */
      async recordView(input: { familyId: string; prescriptionId: string; memberId: string }) {
        await deps.dataFor(input.familyId).create("prescription_views", { prescription_id: input.prescriptionId, member_id: input.memberId, viewed_at: now().toISOString() });
      },

      /** Compartilhar no WhatsApp: grava o compartilhamento + auditoria e enfileira a mensagem (URL assinada de curta duração). */
      async share(input: { familyId: string; prescriptionId: string; memberId: string; targetMemberId: string }): Promise<{ shared: boolean }> {
        const data = deps.dataFor(input.familyId);
        const rx = await domain.getPrescriptionForSharing({ familyId: input.familyId, memberId: input.memberId, prescriptionId: input.prescriptionId });
        if (!rx) return { shared: false };
        await data.create("prescription_shares", {
          prescription_id: input.prescriptionId, shared_by_member_id: input.memberId, channel: "whatsapp", target_member_id: input.targetMemberId, shared_at: now().toISOString(),
        });
        await audit(input.familyId, input.memberId, "prescription.share_whatsapp", "prescription", input.prescriptionId, { target: "member" });
        await enqueue(
          data,
          {
            kind: "reply", template: "prescription_shared", targetMemberId: input.targetMemberId,
            dedupeKey: `rx_share:${input.prescriptionId}:${input.targetMemberId}:${now().getTime()}`,
            params: {
              familyId: input.familyId, prescriptionId: rx.prescriptionId, patientName: rx.patientName,
              ...(rx.doctorName ? { doctorName: rx.doctorName } : {}), ...(rx.specialty ? { specialty: rx.specialty } : {}),
              ...(rx.validUntil ? { validUntil: dateOnlyBR(rx.validUntil) } : {}), medications: rx.medications, imageUrl: rx.imageUrl, mimeType: rx.mimeType,
            },
          },
          now(),
        );
        return { shared: true };
      },
    },
  };
}

const dateOnlyBR = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export type Services = ReturnType<typeof buildServices>;