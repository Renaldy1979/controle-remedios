import type { ActionResult } from "@/server/actions";
import * as srv from "@/server/actions";
import type { Actions, AttachDraft, ConnectionStatus, DataSource, NotificationSettingsVM, Snapshot } from "./types";

const hhmm = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

export interface RemoteHooks {
  onError(message: string): void;
}

/**
 * DataSource da origem real: o retrato vem do servidor (já calculado por @medcuidar/domain) e cada
 * ação é uma Server Action que devolve o retrato novo. As ações rodam em fila (uma por vez) para
 * que as respostas nunca se atropelem. Só confirmar dose e os interruptores têm resposta imediata.
 */
export class RemoteDataSource implements DataSource {
  readonly kind = "appwrite" as const;
  private snap: Snapshot;
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private status: ConnectionStatus = { offline: false, dataAsOf: hhmm() };

  constructor(
    initial: Snapshot,
    private hooks: RemoteHooks,
  ) {
    this.snap = initial;
  }

  getSnapshot = () => this.snap;

  connection = {
    getStatus: () => this.status,
    retry: () => this.refresh(),
  };

  private setOnline(online: boolean) {
    if (online) this.status = { offline: false, dataAsOf: hhmm() };
    else if (!this.status.offline) this.status = { ...this.status, offline: true };
    else return;
    this.emit();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** O servidor mandou um retrato mais novo (navegação, atualização periódica). */
  replace(s: Snapshot) {
    this.snap = s;
    this.emit();
  }

  setHooks(h: RemoteHooks) {
    this.hooks = h;
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Executa uma ação; `false` = falhou (aviso já mostrado). */
  private async exec<T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T | undefined) => void): Promise<boolean> {
    const r = await this.enqueue(async () => {
      try {
        return await fn();
      } catch {
        this.setOnline(false);
        return { ok: false, message: "Sem conexão. Confira a internet e tente de novo." } as ActionResult<T>;
      }
    });
    if (!r.ok) {
      this.hooks.onError(r.message);
      if (r.unauthorized && typeof window !== "undefined") window.location.assign("/login");
      await this.refresh(); // desfaz qualquer resposta otimista
      return false;
    }
    this.snap = r.snapshot;
    this.emit();
    onOk?.(r.data);
    return true;
  }

  async refresh(): Promise<void> {
    try {
      const r = await srv.loadSnapshotAction();
      if (r.ok) {
        this.replace(r.snapshot);
        this.setOnline(true);
      }
    } catch {
      this.setOnline(false); // offline: mantém o último retrato (cache em memória)
    }
  }

  private patch(fn: (s: Snapshot) => Snapshot) {
    this.snap = fn(this.snap);
    this.emit();
  }

  previewStockDays = async (medId: string, delta: number): Promise<number> => {
    const r = await srv.previewStockDaysAction(medId, delta);
    return r.ok ? r.days : 0;
  };

  actions: Actions = {
    confirmDose: (doseId) => {
      this.patch((s) => {
        const doses = s.doses.map((d) => (d.id === doseId ? { ...d, status: "taken" as const, doneBy: s.member.name, doneAt: "agora", channel: "panel" as const, whenLabel: "Tomada agora" } : d));
        return { ...s, doses, alertCount: doses.filter((d) => d.status === "late" || d.status === "missed").length };
      });
      return this.exec(() => srv.confirmDoseAction(doseId));
    },
    undoDose: (id) => this.exec(() => srv.undoDoseAction(id)),
    snoozeDose: (id, minutes) => this.exec(() => srv.snoozeDoseAction(id, minutes)),
    registerLate: (id) => this.actions.confirmDose(id),
    assumeReplenishment: (medId) => this.exec(() => srv.assumeReplenishmentAction(medId)),
    advanceReplenishment: (medId, opts) => this.exec(() => srv.advanceReplenishmentAction(medId, opts?.quantity)),
    saveRx: async (draft: AttachDraft) => {
      const { files, ...rest } = draft;
      const form = new FormData();
      form.set("draft", JSON.stringify(rest));
      for (const f of files ?? []) form.append("files", f);
      let id: string | null = null;
      const ok = await this.exec(() => srv.saveRxAction(form), (data) => {
        id = data ?? null;
      });
      return ok ? id : null;
    },
    deleteRx: (id) => this.exec(() => srv.deleteRxAction(id)),
    restoreRx: (id) => this.exec(() => srv.restoreRxAction(id)),
    markSuperseded: (id) => this.exec(() => srv.markSupersededAction(id)),
    recordRxView: async (id) => {
      await srv.recordRxViewAction(id);
    },
    shareRx: (id, target, channel) => this.exec(() => srv.shareRxAction(id, target, channel)),
    registerPurchase: (medId, qty) => this.exec(() => srv.registerPurchaseAction(medId, qty)),
    adjustStock: (medId, newBalance, reason) => this.exec(() => srv.adjustStockAction(medId, newBalance, reason)),
    setPermission: (rowId, profile, value) => {
      this.patch((s) => ({ ...s, permissionRows: s.permissionRows.map((r) => (r.id === rowId ? { ...r, values: r.values.map((v, i) => (s.profiles[i] === profile ? value : v)) } : r)) }));
      return this.exec(() => srv.setPermissionAction(rowId, profile, value));
    },
    setNotification: (patch: Partial<NotificationSettingsVM>) => {
      this.patch((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
      return this.exec(() => srv.setNotificationAction(patch));
    },
    updateMedication: (id, patch) => this.exec(() => srv.updateMedicationAction(id, patch)),
    saveScheme: (medId, input) => this.exec(() => srv.saveSchemeAction(medId, input)),
    inviteMember: (input) => this.exec(() => srv.inviteMemberAction(input)),
    updateMember: (id, input) => this.exec(() => srv.updateMemberAction(id, input)),
    removeMember: (id) => this.exec(() => srv.removeMemberAction(id)),
    deleteMedication: (id) => this.exec(() => srv.deleteMedicationAction(id)),
    restoreMedication: (id) => this.exec(() => srv.restoreMedicationAction(id)),
    viewAs: () => undefined,
  };
}
