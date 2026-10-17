/**
 * Smoke de integração CONTRA O APPWRITE REAL, só na família demo (`demo-familia-souza`).
 * Roda o caminho completo com o domínio real e o canal FALSO (nada vai para o WhatsApp):
 *   gerar doses de hoje → resolver responsáveis → agendador + fila enviam o lembrete (canal falso)
 *   → confirmar dose → conferir desconto no estoque → repetir (idempotência) → desfazer → conferir devolução.
 * Tudo que o teste cria é registrado e removido no fim (e na próxima execução, se esta cair no meio);
 * o saldo em cache do estoque é restaurado. Uso:  pnpm --filter @medcuidar/functions e2e:demo
 */
import { FakeChannel } from "@medcuidar/channels";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processOutbox } from "../src/outbox";
import type { FamilyData, FindOptions, Row, Where } from "../src/ports";
import { createRuntime } from "../src/runtime";
import { runSchedulerTick } from "../src/scheduler";
import { buildServices } from "../src/services";
import { localDate } from "../src/time";

const FAMILY_ID = "demo-familia-souza";
const PATIENT_ID = "demo-p-adelino";
const MEDICATION_ID = "demo-med-zypred";
const TREATMENT_ID = "demo-t-zypred-adelino";
const STOCK_ITEM_ID = "demo-s-zypred-adelino";
const MEMBER_ID = "demo-m-ana";
const JOURNAL = join(tmpdir(), "medcuidar-e2e-demo-created.json");

const out = (line: string) => process.stdout.write(`${line}\n`);
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  out(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

type Created = { collection: string; id: string };
type Snapshot = { collection: string; id: string; before: Record<string, unknown> };
type Journal = { created: Created[]; snapshots: Snapshot[] };

/**
 * Registra, em disco, tudo que é criado (para remover) e o valor anterior dos campos de documentos que já
 * existiam e foram alterados (para restaurar) — mesmo se o script cair no meio.
 */
class RecordingData implements FamilyData {
  constructor(
    private readonly inner: FamilyData,
    private readonly journal: Journal,
  ) {}
  get familyId() {
    return this.inner.familyId;
  }
  private save() {
    writeFileSync(JOURNAL, JSON.stringify(this.journal));
  }
  async create(collection: string, data: Record<string, unknown>, id?: string) {
    const row = await this.inner.create(collection, data, id);
    this.journal.created.push({ collection, id: row.$id });
    this.save();
    return row;
  }
  get(collection: string, id: string) {
    return this.inner.get(collection, id);
  }
  getOrNull(collection: string, id: string) {
    return this.inner.getOrNull(collection, id);
  }
  find(collection: string, where?: Where, options?: FindOptions) {
    return this.inner.find(collection, where, options);
  }
  async update(collection: string, id: string, data: Record<string, unknown>) {
    const ours = this.journal.created.some((c) => c.collection === collection && c.id === id);
    const seen = this.journal.snapshots.some((s) => s.collection === collection && s.id === id);
    if (!ours && !seen) {
      const row = await this.inner.getOrNull(collection, id);
      if (row) {
        this.journal.snapshots.push({ collection, id, before: Object.fromEntries(Object.keys(data).map((k) => [k, row[k] ?? null])) });
        this.save();
      }
    }
    return this.inner.update(collection, id, data);
  }
  remove(collection: string, id: string) {
    return this.inner.remove(collection, id);
  }
}

async function cleanup(data: FamilyData, journal: Journal) {
  let removed = 0;
  for (const c of [...journal.created].reverse()) {
    try {
      await data.remove(c.collection, c.id);
      removed += 1;
    } catch (e) {
      if ((e as { code?: number }).code !== 404) out(`  (aviso) não removeu ${c.collection}/${c.id}`);
    }
  }
  for (const s of journal.snapshots) {
    try {
      await data.update(s.collection, s.id, s.before);
    } catch {
      out(`  (aviso) não restaurou ${s.collection}/${s.id}`);
    }
  }
  return { removed, restored: journal.snapshots.length };
}

async function main() {
  process.env["LOGIN_CODE_SECRET"] ??= "e2e-demo-local";
  const channel = new FakeChannel(); // NUNCA o WhatsApp real
  const journal: Journal = { created: [], snapshots: [] };

  // Sobras de uma execução anterior que caiu no meio.
  const probe = createRuntime(process.env, { channel });
  const rawData = probe.dataFor(FAMILY_ID);
  if (existsSync(JOURNAL)) {
    const left = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
    out(`Limpando ${left.created.length} registros de uma execução anterior...`);
    await cleanup(rawData, left);
    unlinkSync(JOURNAL);
  }

  const rt = createRuntime(process.env, { channel, wrapData: (d) => new RecordingData(d, journal) });
  const data = rt.dataFor(FAMILY_ID);
  const svc = buildServices({ global: rt.global, dataFor: rt.dataFor, domain: rt.domain, channel, login: rt.login });

  const families = await rt.global.listFamilies();
  const family = families.find((f) => f.id === FAMILY_ID);
  if (!family) throw new Error(`Família ${FAMILY_ID} não existe. Rode: pnpm seed`);
  out(`Família demo encontrada: ${FAMILY_ID} (somente ela é tocada; canal FALSO)\n`);

  const stockBefore = await rawData.get("stock_items", STOCK_ITEM_ID);
  const restore = { cached_balance: stockBefore["cached_balance"] as number, cached_balance_at: (stockBefore["cached_balance_at"] as string | undefined) ?? new Date().toISOString() };
  const ledgerStart = await svc.stock.balance(FAMILY_ID, STOCK_ITEM_ID);
  out(`Saldo inicial do Zypred (livro-razão): ${ledgerStart}`);

  try {
    // 1) gerar doses de hoje (domínio real; índice único treatment+horário)
    const today = localDate(new Date(), family.timezone);
    const gen = await rt.domain.generateDoseEvents({ familyId: FAMILY_ID, date: today });
    const again = await rt.domain.generateDoseEvents({ familyId: FAMILY_ID, date: today });
    check("gerar doses de hoje", gen.created >= 0, `${gen.created} criadas`);
    check("gerar de novo não duplica (idempotente)", again.created === 0);

    // Dose exclusiva do teste (horário fora da agenda, para não colidir com o índice único).
    const scheduledAt = new Date(Date.now() - 60_000 * 3 - (Date.now() % 1000));
    const dose = await data.create("dose_events", {
      treatment_id: TREATMENT_ID, patient_id: PATIENT_ID, medication_id: MEDICATION_ID, scheduled_at: scheduledAt.toISOString(), status: "pending", amount: 2,
    });

    // 2) responsáveis
    const who = await rt.domain.resolveResponsible({ familyId: FAMILY_ID, patientId: PATIENT_ID, at: scheduledAt });
    check("resolver responsáveis", who.length > 0, `${who.length} pessoa(s)`);

    // 3) agendador + fila enviam o lembrete pelo canal FALSO
    const tick = await runSchedulerTick(rt.scheduler, new Date());
    const queue = await processOutbox(rt.outbox, new Date());
    check("agendador rodou sem erro", tick.errors === 0, JSON.stringify(tick));
    check("lembrete enviado pelo canal falso", channel.sent.some((m) => m.text.includes("Adelino") && /Hora do remédio|Dose atrasada|Dose esquecida/.test(m.text)), `${channel.sent.length} mensagem(ns), fila: ${JSON.stringify(queue)}`);
    check("nada foi para o WhatsApp real", channel.name === "fake");

    // 4) confirmar → desconto
    const c1 = await svc.doses.confirm({ familyId: FAMILY_ID, doseEventId: dose.$id, memberId: MEMBER_ID, channel: "system" });
    const afterConfirm = await svc.stock.balance(FAMILY_ID, STOCK_ITEM_ID);
    check("confirmar dose", c1.result.outcome === "confirmed", c1.result.outcome);
    check("estoque descontou 2 gotas", afterConfirm === ledgerStart - 2, `${ledgerStart} → ${afterConfirm}`);

    // 5) idempotência
    const c2 = await svc.doses.confirm({ familyId: FAMILY_ID, doseEventId: dose.$id, memberId: MEMBER_ID, channel: "system" });
    check("confirmar de novo não desconta", c2.result.outcome === "already_taken" && (await svc.stock.balance(FAMILY_ID, STOCK_ITEM_ID)) === afterConfirm);

    // 6) desfazer → devolução
    const undo = await svc.doses.undo({ familyId: FAMILY_ID, doseEventId: dose.$id, memberId: MEMBER_ID });
    const afterUndo = await svc.stock.balance(FAMILY_ID, STOCK_ITEM_ID);
    check("desfazer", undo.result === "undone");
    check("estoque devolvido", afterUndo === ledgerStart, `${afterConfirm} → ${afterUndo}`);
  } catch (e) {
    failures += 1;
    out(`✗ erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Limpeza: remove o que foi criado e restaura o saldo em cache do estoque.
    const { removed, restored } = await cleanup(rawData, journal);
    await rawData.update("stock_items", STOCK_ITEM_ID, restore);
    if (existsSync(JOURNAL)) unlinkSync(JOURNAL);
    const ledgerEnd = await svc.stock.balance(FAMILY_ID, STOCK_ITEM_ID);
    check("limpeza: livro-razão voltou ao início", ledgerEnd === ledgerStart, `${removed} registros removidos, ${restored} restaurados`);
  }

  out(failures === 0 ? "\nTudo certo." : `\n${failures} verificação(ões) falharam.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  out(`Falha: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});

export type { Row };
