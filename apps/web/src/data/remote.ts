import type { ActionResult } from "@/server/pg/actions";
import * as srv from "@/server/pg/actions";
import type { Actions, ConnectionStatus, DataSource, InviteResult, NotificationSettingsVM, Snapshot } from "./types";

const hhmm = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

export interface RemoteHooks {
  onError(message: string): void;
}

const NEXT_LOT = "Isto chega nos próximos lotes.";

/**
 * DataSource da origem real (Postgres): o retrato vem do servidor e cada ação é uma Server Action que devolve o
 * retrato novo. As ações rodam em fila (uma por vez) para que as respostas nunca se atropelem.
 * Doses, estoque, receitas e reposição ainda não existem aqui (Lotes 2 e 3): essas ações só avisam.
 */
export class RemoteDataSource implements DataSource {
  readonly kind = "postgres" as const;
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
      await this.refresh();
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

  previewStockDays = async (): Promise<number> => 0;

  private notYet = (): boolean => {
    this.hooks.onError(NEXT_LOT);
    return false;
  };

  private async withData<T>(fn: () => Promise<ActionResult<T>>): Promise<T | null> {
    let out: T | null = null;
    const ok = await this.exec(fn, (d) => {
      out = d ?? null;
    });
    return ok ? out : null;
  }

  actions: Actions = {
    // Lotes 2 e 3
    confirmDose: this.notYet,
    undoDose: this.notYet,
    snoozeDose: this.notYet,
    registerLate: this.notYet,
    assumeReplenishment: this.notYet,
    advanceReplenishment: this.notYet,
    saveRx: () => {
      this.hooks.onError(NEXT_LOT);
      return null;
    },
    deleteRx: this.notYet,
    restoreRx: this.notYet,
    markSuperseded: this.notYet,
    recordRxView: () => undefined,
    shareRx: this.notYet,
    registerPurchase: this.notYet,
    adjustStock: this.notYet,
    setNotification: (patch: Partial<NotificationSettingsVM>) => {
      this.patch((s) => ({ ...s, notifications: { ...s.notifications, ...patch } }));
      return this.notYet();
    },
    viewAs: () => undefined,

    // Lote 1
    setPermission: (rowId, profile, value) => {
      this.patch((s) => ({ ...s, permissionRows: s.permissionRows.map((r) => (r.id === rowId ? { ...r, values: r.values.map((v, i) => (s.profiles[i] === profile ? value : v)) } : r)) }));
      return this.exec(() => srv.setPermissionAction(rowId, profile, value));
    },
    updateMedication: (id, patch) => this.exec(() => srv.updateMedicationAction(id, patch)),
    saveScheme: (medId, input) => this.exec(() => srv.saveSchemeAction(medId, input)),
    inviteMember: (input): Promise<InviteResult | null> => this.withData(() => srv.inviteMemberAction(input)),
    updateMember: (id, input) => this.exec(() => srv.updateMemberAction(id, input)),
    removeMember: (id) => this.exec(() => srv.removeMemberAction(id)),
    reactivateMember: (id) => this.exec(() => srv.reactivateMemberAction(id)),
    resendInvite: (id): Promise<InviteResult | null> => this.withData(() => srv.resendInviteAction(id)),
    revokeInvite: (id) => this.exec(() => srv.revokeInviteAction(id)),
    savePatient: (input) => this.withData(() => srv.savePatientAction(input)),
    deletePatient: (id) => this.exec(() => srv.deletePatientAction(id)),
    createMedication: (input) => this.withData(() => srv.createMedicationAction(input)),
    deleteMedication: (id) => this.exec(() => srv.deleteMedicationAction(id)),
    restoreMedication: (id) => this.exec(() => srv.restoreMedicationAction(id)),
    saveMyPhone: (phone) => this.exec(() => srv.saveMyPhoneAction(phone)),
  };
}
