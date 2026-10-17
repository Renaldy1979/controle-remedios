import { describe, expect, it } from "vitest";
import { COVERS_UNTIL_END } from "./domain/binding";
import { ledgerBalance } from "./domain/repo";
import { buildRealWorld } from "./testing/real-world";
import { FAMILY_ID, PHONES } from "./testing/world";

/**
 * Mesmos cenários de flow.test/scheduler.test, agora contra o DOMÍNIO REAL (@medcuidar/domain) ligado
 * por `createDomainPort`, com dados em memória.
 */
const sentTo = (w: ReturnType<typeof buildRealWorld>, phone: string) => w.channel.sent.filter((m) => m.to === phone);

describe("domínio real: lembrete → Tomei → desconto → alerta de estoque", () => {
  it("fluxo completo com botões", async () => {
    const w = buildRealWorld({ zypredBalance: 56 });
    const report = await w.tick();
    expect(report.dosesGenerated).toBe(0); // agenda do dia já gravada: gerador idempotente
    expect(report.reminders).toBe(1);
    await w.flushOutbox();

    // Só Rosa (escala) recebe; Ana e Seu João não.
    expect(sentTo(w, PHONES.rosa)).toHaveLength(1);
    expect(sentTo(w, PHONES.joao)).toHaveLength(0);
    const tomei = sentTo(w, PHONES.rosa)[0]!.buttons![0]!;
    expect(tomei.label).toBe("Tomei");

    w.advance(1); // a confirmação chega um minuto depois do horário
    await w.press(PHONES.rosa, tomei.id);
    expect(w.movements()).toHaveLength(1);
    expect(w.movements()[0]).toMatchObject({ quantity: -1, dose_event_id: "dose-zyp" });
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("taken");
    expect(Number((await w.data.get("stock_items", "stk-zypred"))["cached_balance"])).toBe(55);
    expect(await ledgerBalance(w.data, "stk-zypred")).toBe(55);

    await w.flushOutbox();
    expect(w.channel.sent.some((m) => m.to === PHONES.rosa && m.text.includes("Anotado"))).toBe(true);
    // 55 gotas, resta 1 dose hoje e 4/dia: cobre 14 dias → atenção (limite 7 → atenção até 14).
    const low = sentTo(w, PHONES.ana).find((m) => m.text.includes("Estoque baixo"))!;
    expect(low.text).toContain("14 dias");
    expect(low.text).toContain("estimativa");

    // A reposição já nasce em "receita recebida" (há receita vigente do Zypred), com etapas 1–2 cumpridas.
    const [repl] = w.store.all("replenishments");
    expect(repl).toMatchObject({ patient_id: "pat-adelino", medication_id: "med-zypred", status: "prescription_received", triggered_by: "low_stock" });
    expect(w.store.all("replenishment_steps").map((x) => x["step"]).sort()).toEqual([1, 2]);

    // Rodar de novo não abre outra reposição nem repete o aviso.
    await w.tick();
    expect(w.store.all("replenishments")).toHaveLength(1);
    expect(w.outbox().filter((o) => o["kind"] === "low_stock")).toHaveLength(1);
  });

  it("repetição da mesma mensagem, outra mensagem depois da dose tomada e mesma mensagem em doses diferentes: um desconto só", async () => {
    const w = buildRealWorld({ twoPending: true });
    await w.tick();
    await w.flushOutbox();
    const id = `mc1:dose_taken:${FAMILY_ID}:dose-zyp`;
    const message = w.msg(PHONES.rosa, { type: "button", buttonId: id });
    await w.deliver([message]);
    await w.deliver([message]);
    await w.press(PHONES.rosa, id); // outra mensagem, dose já tomada
    expect(w.movements()).toHaveLength(1);

    // O MESMO id de mensagem do provedor usado para outra dose não confirma a segunda (índice por source_message_id).
    const res = await w.realDomain.confirmDose({ familyId: FAMILY_ID, doseEventId: "dose-los", memberId: "mem-rosa", channel: "whatsapp", sourceMessageId: message.providerMessageId });
    expect(res.outcome).toBe("already_confirmed");
    expect(w.movements()).toHaveLength(1);
    expect((await w.data.get("dose_events", "dose-los"))["status"]).toBe("pending");
  });

  it("conflito 409 do índice único de dose vira 'duplicado' (insertDoseMovementIfAbsent)", async () => {
    const w = buildRealWorld();
    const repo = w.realDomain.repoFor(FAMILY_ID);
    const mov = { family_id: FAMILY_ID, stock_item_id: "stk-zypred", type: "dose" as const, quantity: -1, dose_event_id: "dose-zyp" };
    expect(await repo.insertDoseMovementIfAbsent(mov)).toBe(true);
    expect(await repo.insertDoseMovementIfAbsent(mov)).toBe(false);
  });

  it("modo texto numerado: '1' confirma; com duas pendentes pergunta antes", async () => {
    const w = buildRealWorld({ twoPending: true });
    w.channel.supportsButtons = false;
    await w.tick();
    await w.flushOutbox();
    await w.say(PHONES.rosa, "tomei");
    expect(w.movements()).toHaveLength(0); // duas possíveis: nunca adivinha
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Qual dose");
    w.advance(0.1);
    await w.say(PHONES.rosa, "2");
    expect(w.movements()).toHaveLength(1);
  });
});

describe("domínio real: agendador", () => {
  it("atraso, esquecida (família e responsável avisadas) e nenhum lembrete depois", async () => {
    const w = buildRealWorld();
    await w.tick();
    w.advance(15);
    await w.tick();
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("late");
    w.advance(105);
    const r = await w.tick();
    expect(r.missed).toBeGreaterThanOrEqual(1);
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("missed");
    await w.flushOutbox();
    expect(sentTo(w, PHONES.ana).some((m) => m.text.includes("Dose esquecida"))).toBe(true);
    expect(w.outbox().filter((o) => o["kind"] === "dose_reminder")).toHaveLength(2);
  });

  it("gera a agenda do dia seguinte uma única vez (índice treatment+horário)", async () => {
    const w = buildRealWorld();
    const first = await w.realDomain.generateDoseEvents({ familyId: FAMILY_ID, date: "2026-10-16" });
    expect(first.created).toBe(5); // Zypred 4x + Losartana 1x
    expect((await w.realDomain.generateDoseEvents({ familyId: FAMILY_ID, date: "2026-10-16" })).created).toBe(0);
    const times = w.store.all("dose_events").filter((d) => String(d["scheduled_at"]).startsWith("2026-10-16")).map((d) => d["scheduled_at"]);
    expect(times).toContain("2026-10-16T11:00:00.000Z"); // 08:00 em São Paulo
  });

  it("sem escala cobrindo o horário, o lembrete cai para quem recebe avisos da família", async () => {
    const w = buildRealWorld();
    for (const a of w.store.all("care_assignments")) w.store.table("care_assignments").set(a.$id, { ...a, start_time: "06:00", end_time: "14:00" });
    const ids = await w.realDomain.resolveResponsible({ familyId: FAMILY_ID, patientId: "pat-adelino", at: new Date("2026-10-15T17:00:00Z") });
    expect(ids).toEqual(["mem-ana"]);
  });

  it("receita que vence em 10 dias é avisada; estoque em visão geral", async () => {
    const w = buildRealWorld();
    await w.tick();
    await w.flushOutbox();
    expect(sentTo(w, PHONES.ana).some((m) => m.text.includes("Receita vence em 10 dias"))).toBe(true);
    const overview = await w.realDomain.stockOverview({ familyId: FAMILY_ID });
    const zyp = overview.find((l) => l.medicationName === "Zypred")!;
    expect(zyp).toMatchObject({ level: "ok", isEstimate: true });
    expect(zyp.daysLeft).toBe(15); // 60 gotas, restam 2 doses hoje (as já tomadas não contam) e 4/dia
    expect(overview.find((l) => l.medicationName === "Losartana")!.daysLeft).toBeGreaterThan(14);
    expect(COVERS_UNTIL_END).toBeGreaterThan(3000);
  });

  it("resumo diário às 20:00 usa a previsão real", async () => {
    const w = buildRealWorld({ now: new Date("2026-10-15T23:00:00.000Z"), zypredBalance: 20 });
    const r = await w.tick();
    expect(r.summaries).toBe(1);
    await w.flushOutbox();
    const msg = sentTo(w, PHONES.ana).find((m) => m.text.includes("Resumo do dia"))!;
    expect(msg.text).toContain("Estoque crítico");
    expect(msg.text).toContain("Zypred");
  });
});

describe("domínio real: reposição e receita", () => {
  it("'Eu cuido disso': Ana assume; outra pessoa vê quem cuida; id inexistente", async () => {
    const w = buildRealWorld({ zypredBalance: 20 });
    await w.tick();
    const alert = (await w.realDomain.checkLowStock({ familyId: FAMILY_ID, patientId: "pat-adelino" }))[0]!;
    expect(alert.level).toBe("critical");
    const first = await w.realDomain.claimReplenishment({ familyId: FAMILY_ID, replenishmentId: alert.replenishmentId, memberId: "mem-ana" });
    expect(first).toMatchObject({ outcome: "claimed", ownerName: "Ana", alreadyOwner: false });
    const again = await w.realDomain.claimReplenishment({ familyId: FAMILY_ID, replenishmentId: alert.replenishmentId, memberId: "mem-ana" });
    expect(again).toMatchObject({ outcome: "claimed", alreadyOwner: true });
    const other = await w.realDomain.claimReplenishment({ familyId: FAMILY_ID, replenishmentId: alert.replenishmentId, memberId: "mem-joao" });
    expect(other).toMatchObject({ outcome: "taken_by_other", ownerName: "Ana" });
    expect(await w.realDomain.claimReplenishment({ familyId: FAMILY_ID, replenishmentId: "nao-existe", memberId: "mem-ana" })).toEqual({ outcome: "not_found" });
    // Etapa atual (3, "comprado") ficou com a Ana, gravada em replenishment_steps.
    expect(w.store.all("replenishment_steps").find((s) => s["step"] === 3)).toMatchObject({ owner_member_id: "mem-ana" });
  });

  it("'Ver receita' entrega URL assinada, só com arquivo; botão no WhatsApp grava compartilhamento e auditoria", async () => {
    const w = buildRealWorld({ zypredBalance: 20 });
    w.store.seed("prescription_files", FAMILY_ID, "rxf-1", { prescription_id: "rx-zypred", storage_file_id: "file-123", page: 1, mime: "image/jpeg", size: 1000 });
    await w.tick();
    await w.flushOutbox();
    const claim = sentTo(w, PHONES.ana).find((m) => m.text.includes("Estoque baixo"))!;
    await w.press(PHONES.ana, claim.buttons![1]!.id); // Ver receita
    await w.flushOutbox();
    const rx = sentTo(w, PHONES.ana).find((m) => m.media)!;
    expect(rx.media!.url).toContain("file-123");
    expect(rx.text).toContain("Acesso restrito");
    expect(w.store.all("prescription_shares")).toHaveLength(1);
    expect(w.store.all("audit_log").some((a) => a["action"] === "prescription.share_whatsapp")).toBe(true);
  });

  it("classifica o tempo da dose com as regras reais", () => {
    const w = buildRealWorld();
    const base = { status: "pending" as const, scheduledAt: new Date("2026-10-15T17:00:00Z"), lateAfterMin: 15, missedAfterMin: 120 };
    const at = (min: number) => new Date(base.scheduledAt.getTime() + min * 60_000);
    expect(w.realDomain.classifyDoseTiming({ ...base, now: at(5) })).toBe("pending");
    expect(w.realDomain.classifyDoseTiming({ ...base, now: at(20) })).toBe("late");
    expect(w.realDomain.classifyDoseTiming({ ...base, now: at(130) })).toBe("missed");
    expect(w.realDomain.classifyDoseTiming({ ...base, status: "late", now: at(20) })).toBe("late");
  });
});
