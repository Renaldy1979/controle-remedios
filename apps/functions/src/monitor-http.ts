import type { AlertEvent, Logger, Monitor } from "./ports";

export interface HttpMonitorConfig {
  /** URL de "push" de um monitor externo (Uptime Kuma, Healthchecks...). Se o ping parar, ele alerta. */
  heartbeatUrl?: string;
  /** Webhook do N8N (workflow `alertas-operacionais`) que avisa o administrador. */
  alertsWebhookUrl?: string;
  alertsSecret?: string;
  fetch?: typeof fetch;
  log: Logger;
}

/**
 * Heartbeat observável + alertas operacionais. Nenhum campo carrega dado pessoal
 * (só ids e contagens); falha de rede aqui nunca derruba o job.
 */
export class HttpMonitor implements Monitor {
  private readonly doFetch: typeof fetch;
  private lastAlert = new Map<string, number>();

  constructor(private readonly cfg: HttpMonitorConfig) {
    this.doFetch = cfg.fetch ?? fetch;
  }

  async heartbeat(name: string, info: Record<string, string | number | boolean>): Promise<void> {
    this.cfg.log.info("heartbeat", { name, ...info });
    if (!this.cfg.heartbeatUrl) return;
    try {
      const url = new URL(this.cfg.heartbeatUrl);
      url.searchParams.set("status", "up");
      url.searchParams.set("msg", name);
      await this.doFetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch {
      this.cfg.log.warn("heartbeat.failed", { name });
    }
  }

  async alert(event: AlertEvent): Promise<void> {
    // Evita repetir o mesmo alerta a cada minuto (ex.: provedor fora do ar).
    const key = `${event.kind}:${String(event.details["familyId"] ?? "")}`;
    const now = Date.now();
    if (now - (this.lastAlert.get(key) ?? 0) < 15 * 60_000) return;
    this.lastAlert.set(key, now);
    this.cfg.log.error("alert", { kind: event.kind });
    if (!this.cfg.alertsWebhookUrl) return;
    try {
      await this.doFetch(this.cfg.alertsWebhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.cfg.alertsSecret ? { "x-medcuidar-secret": this.cfg.alertsSecret } : {}) },
        body: JSON.stringify({ ...event, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      this.cfg.log.warn("alert.delivery_failed", { kind: event.kind });
    }
  }
}
