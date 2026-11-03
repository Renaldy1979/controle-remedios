import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { alertarAdministradores } from "../wa/alertas";
import { gravarRuntime, lerRuntime } from "../wa/runtime";

/**
 * Estado do backup noturno, informado pelo próprio serviço `apps/backup` ao fim de cada rodada (POST /api/internal/backup-report) e
 * guardado em `whatsapp_runtime` (chave `backup`). O portal alerta os administradores (sino) quando a rodada FALHA e quando o serviço
 * SOME (nenhum sucesso há mais de HORAS_ATE_ATRASAR). Nada aqui leva texto de erro: só se deu certo, quando e o tamanho.
 */
export const HORAS_ATE_ATRASAR = 30; // backup diário às 03:00 + folga para uma rodada longa ou um deploy
export const INTERVALO_CONFERENCIA_MS = 10 * 60_000;

export interface EstadoBackup {
  /** última rodada informada (ok ou falha) */
  ultimaEm: string;
  ultimaOk: boolean;
  /** último SUCESSO */
  ultimoSucessoEm: string | null;
  bytes: number | null;
  /** chave do atraso já avisado (ultimoSucessoEm), para avisar uma vez só */
  atrasoAvisadoDe: string | null;
}

export type SituacaoBackup = "ok" | "falhou" | "atrasado" | "sem_registro";

export interface RelatorioBackup { ok: boolean; em: Date; bytes: number | null }

export function segredoDoRelatorioConfere(recebido: string, esperado = (process.env["BACKUP_REPORT_SECRET"] ?? "").trim()): boolean {
  if (esperado.length < 16) return false;
  const a = createHash("sha256").update(String(recebido ?? "")).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

/** Lê e valida o corpo do relatório. Devolve null se o formato estiver errado. `agora` limita datas absurdas. */
export function lerRelatorio(corpo: unknown, agora = new Date()): RelatorioBackup | null {
  if (!corpo || typeof corpo !== "object") return null;
  const c = corpo as Record<string, unknown>;
  if (typeof c["ok"] !== "boolean") return null;
  const em = typeof c["at"] === "string" ? new Date(c["at"]) : agora;
  if (Number.isNaN(em.getTime()) || Math.abs(agora.getTime() - em.getTime()) > 48 * 3600_000) return null;
  const bytes = typeof c["bytes"] === "number" && Number.isFinite(c["bytes"]) && c["bytes"] >= 0 ? Math.floor(c["bytes"]) : null;
  return { ok: c["ok"], em, bytes };
}

/** Registra a rodada. Falha => avisa os administradores (uma vez por rodada). */
export async function registrarRelatorioBackup(r: RelatorioBackup, agora = new Date()): Promise<EstadoBackup> {
  const antes = await lerRuntime<EstadoBackup>("backup");
  const novo: EstadoBackup = {
    ultimaEm: r.em.toISOString(),
    ultimaOk: r.ok,
    ultimoSucessoEm: r.ok ? r.em.toISOString() : (antes?.ultimoSucessoEm ?? null),
    bytes: r.ok ? r.bytes : (antes?.bytes ?? null),
    atrasoAvisadoDe: r.ok ? null : (antes?.atrasoAvisadoDe ?? null),
  };
  await gravarRuntime("backup", novo, agora);
  if (!r.ok) {
    await alertarAdministradores(
      `backup-falhou:${novo.ultimaEm}`, "O backup automático falhou",
      "A última rodada do backup automático não terminou. Seus dados continuam no sistema, mas sem cópia nova. Veja o log do serviço medcuidar-backup no EasyPanel (docs/12-backup.md).",
      "backup_falhou", agora,
    );
  }
  return novo;
}

export function situacaoDoBackup(e: EstadoBackup | null, agora = new Date()): SituacaoBackup {
  if (!e) return "sem_registro";
  if (!e.ultimoSucessoEm || agora.getTime() - Date.parse(e.ultimoSucessoEm) > HORAS_ATE_ATRASAR * 3600_000) return "atrasado";
  return e.ultimaOk ? "ok" : "falhou";
}

/** Conferência periódica (líder): sem sucesso há muito tempo => avisa uma vez. Sem nenhum relatório ainda, não avisa (não configurado). */
export async function conferirBackup(agora = new Date()): Promise<SituacaoBackup> {
  const e = await lerRuntime<EstadoBackup>("backup");
  const situacao = situacaoDoBackup(e, agora);
  if (e && situacao === "atrasado" && e.atrasoAvisadoDe !== (e.ultimoSucessoEm ?? "nunca")) {
    await alertarAdministradores(
      `backup-atrasado:${e.ultimoSucessoEm ?? "nunca"}`, "O backup automático está atrasado",
      `Faz mais de ${HORAS_ATE_ATRASAR} horas que não há um backup concluído. Confira se o serviço medcuidar-backup está no ar (docs/12-backup.md).`,
      "backup_atrasado", agora,
    );
    await gravarRuntime("backup", { ...e, atrasoAvisadoDe: e.ultimoSucessoEm ?? "nunca" }, agora);
  }
  return situacao;
}
