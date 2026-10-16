import { decodeButtonId } from "@medcuidar/channels";
import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER } from "./inbound/signature";
import { handleWhatsappInbound } from "./inbound/handler";
import { buildWorld, FAMILY_ID, GROUP_ID, PHONES, seedDose, type World } from "./testing/world";

const DOSE_TIME = new Date("2026-10-15T17:00:00.000Z"); // 14:00 em São Paulo

function setup(opts: Parameters<typeof buildWorld>[0] = {}) {
  const w = buildWorld(opts);
  seedDose(w, "dose-zyp", "pat-adelino", "med-zypred", DOSE_TIME);
  return w;
}

const buttonLabelled = (w: World, label: string, index = -1) => {
  const sent = index >= 0 ? w.channel.sent[index]! : w.lastSent()!;
  const b = sent.buttons!.find((x) => x.label.startsWith(label));
  if (!b) throw new Error(`botão ${label} não encontrado`);
  return b.id;
};

describe("fluxo: lembrete → Tomei → desconto → alerta de estoque", () => {
  it("ponta a ponta com domínio fake", async () => {
    const w = setup({ zypredBalance: 60 }); // 60 gotas / 4 doses por dia = 15 dias (ok)
    const report = await w.tick();
    expect(report.reminders).toBe(1);
    await w.flushOutbox();

    // Rosa (responsável) recebe o lembrete com os dois botões e o nome do paciente.
    const reminder = w.channel.sent[0]!;
    expect(reminder.to).toBe(PHONES.rosa);
    expect(reminder.text).toContain("Adelino");
    expect(reminder.buttons!.map((b) => b.label)).toEqual(["Tomei", "Lembrar em 15 min"]);

    // Rosa toca em "Tomei".
    const res = await w.press(PHONES.rosa, buttonLabelled(w, "Tomei", 0));
    expect(res.status).toBe(200);

    // Estoque descontado uma vez, dose tomada, confirmação enviada.
    expect(w.movements()).toHaveLength(1);
    expect(w.movements()[0]).toMatchObject({ type: "dose", quantity: -1, dose_event_id: "dose-zyp" });
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("taken");
    const confirmation = w.channel.sent.find((m) => m.text.includes("Anotado"));
    expect(confirmation?.to).toBe(PHONES.rosa);

    // 59 gotas / 4 = 14 dias → atenção: Ana (avisos da família) recebe "Estoque baixo" com os botões.
    const lowStock = w.channel.sent.find((m) => m.text.includes("Estoque baixo"));
    expect(lowStock?.to).toBe(PHONES.ana);
    expect(lowStock?.text).toContain("estimativa");
    expect(lowStock?.buttons?.map((b) => b.label)).toEqual(["Eu cuido disso", "Ver receita"]);
  });

  it("'Eu cuido disso' define o responsável e avisa os demais", async () => {
    const w = setup({ zypredBalance: 50 });
    await w.tick();
    await w.flushOutbox();
    await w.press(PHONES.rosa, buttonLabelled(w, "Tomei", 0));
    const alert = w.channel.sent.find((m) => m.text.includes("Estoque baixo"))!;
    const claimId = alert.buttons![0]!.id;
    expect(decodeButtonId(claimId)?.action).toBe("replenish_claim");

    // Rosa (Cuidadora) não tem replenishment.manage; Ana tem.
    await w.press(PHONES.rosa, claimId);
    expect(w.channel.sent.some((m) => m.text.includes("Sem acesso"))).toBe(true);
    await w.press(PHONES.ana, claimId);
    expect(w.channel.sent.some((m) => m.to === PHONES.ana && m.text.includes("Você cuida"))).toBe(true);
  });
});

describe("idempotência", () => {
  it("a mesma mensagem entregue 2 vezes desconta uma vez só", async () => {
    const w = setup();
    await w.tick();
    await w.flushOutbox();
    const id = buttonLabelled(w, "Tomei", 0);
    const message = w.msg(PHONES.rosa, { type: "button", buttonId: id });
    await w.deliver([message]);
    const again = await w.deliver([message]);
    expect(again.status).toBe(200);
    expect(w.domain.confirmCalls).toBe(1);
    expect(w.movements()).toHaveLength(1);
    expect(w.store.all("whatsapp_messages").filter((m) => m["direction"] === "in")).toHaveLength(1);
  });

  it("entrega simultânea (duas passam pela checagem) ainda desconta uma vez, pelo domínio idempotente", async () => {
    const w = setup();
    await w.tick();
    await w.flushOutbox();
    const message = w.msg(PHONES.rosa, { type: "button", buttonId: buttonLabelled(w, "Tomei", 0) });
    await Promise.all([w.deliver([message]), w.deliver([message])]);
    expect(w.movements()).toHaveLength(1);
  });

  it("outra mensagem 'Tomei' depois da dose tomada não desconta de novo", async () => {
    const w = setup();
    await w.tick();
    await w.flushOutbox();
    const id = buttonLabelled(w, "Tomei", 0);
    await w.press(PHONES.rosa, id);
    await w.press(PHONES.rosa, id);
    expect(w.movements()).toHaveLength(1);
    expect(w.channel.sent.some((m) => m.text.includes("Já estava anotado"))).toBe(true);
  });

  it("o agendador não duplica lembretes ao rodar várias vezes", async () => {
    const w = setup();
    await w.tick();
    await w.tick();
    await w.tick();
    expect(w.outbox().filter((o) => o["kind"] === "dose_reminder")).toHaveLength(1);
  });
});

describe("telefone desconhecido e segurança do webhook", () => {
  it("telefone desconhecido é ignorado: sem resposta, sem registro, resposta neutra", async () => {
    const w = setup();
    const res = await w.say(PHONES.stranger, "tomei");
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(w.channel.sent).toHaveLength(0);
    expect(w.outbox()).toHaveLength(0);
    expect(w.store.all("whatsapp_messages")).toHaveLength(0);
    expect(w.domain.confirmCalls).toBe(0);
  });

  it("assinatura inválida é recusada e nada é processado", async () => {
    const w = setup();
    const res = await w.deliver([w.msg(PHONES.rosa, { text: "tomei" })], "sha256=0000");
    expect(res.status).toBe(401);
    expect(w.domain.confirmCalls).toBe(0);
    const noHeader = await handleWhatsappInbound(w.inboundDeps, { rawBody: "{}", headers: {} });
    expect(noHeader.status).toBe(401);
    void SIGNATURE_HEADER;
  });

  it("botão de outra família é ignorado", async () => {
    const w = setup();
    const res = await w.press(PHONES.rosa, "mc1:dose_taken:outra-familia:dose-zyp");
    expect(res.status).toBe(200);
    expect(w.movements()).toHaveLength(0);
  });

  it("em grupo, remetente fora da família é ignorado; membro é atendido no grupo", async () => {
    const w = setup({ settings: { whatsapp_group_id: GROUP_ID } });
    await w.say(PHONES.stranger, "como está o estoque?", GROUP_ID);
    expect(w.outbox()).toHaveLength(0);
    await w.say(PHONES.ana, "como está o estoque?", GROUP_ID);
    await w.flushOutbox();
    const r = w.lastSent()!;
    expect(r.isGroup).toBe(true);
    expect(r.to).toBe(GROUP_ID);
    expect(r.text).toContain("Zypred");
  });

  it("limite de mensagens por telefone ignora o excesso", async () => {
    const w = setup();
    w.inboundDeps.limiter = { allow: () => false };
    await w.say(PHONES.rosa, "oi");
    expect(w.outbox()).toHaveLength(0);
  });
});

describe("texto, áudio e ambiguidade", () => {
  it("'tomei' com uma só dose pendente confirma", async () => {
    const w = setup();
    await w.say(PHONES.rosa, "tomei");
    expect(w.movements()).toHaveLength(1);
  });

  it("'tomei' com duas doses possíveis pergunta com botões e NÃO confirma", async () => {
    const w = setup();
    seedDose(w, "dose-los", "pat-maria", "med-losartana", DOSE_TIME);
    await w.say(PHONES.rosa, "tomei");
    await w.flushOutbox();
    expect(w.domain.confirmCalls).toBe(0);
    const q = w.lastSent()!;
    expect(q.text).toContain("Qual dose");
    expect(q.buttons).toHaveLength(2);
    // Escolher um botão confirma só aquela.
    await w.press(PHONES.rosa, q.buttons![1]!.id);
    expect(w.domain.confirmCalls).toBe(1);
    expect(w.movements()).toHaveLength(1);
  });

  it("'tomei o zypred' resolve o remédio e as marcas alternativas", async () => {
    const w = setup();
    seedDose(w, "dose-los", "pat-maria", "med-losartana", DOSE_TIME);
    await w.say(PHONES.rosa, "Já dei o Facoba do Adelino");
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("taken");
    expect((await w.data.get("dose_events", "dose-los"))["status"]).toBe("pending");
  });

  it("'não tomou' nunca confirma", async () => {
    const w = setup();
    await w.say(PHONES.rosa, "ele ainda não tomou");
    expect(w.domain.confirmCalls).toBe(0);
  });

  it("áudio é transcrito, guardado e tratado como texto", async () => {
    const w = setup();
    w.channel.mediaStore.set("aud1", { data: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg" });
    w.transcriber.next = "tomei o zypred";
    await w.deliver([w.msg(PHONES.rosa, { type: "audio", media: { mimeType: "audio/ogg", ref: "aud1" } })]);
    expect(w.transcriber.calls).toBe(1);
    expect(w.movements()).toHaveLength(1);
    const stored = w.store.all("whatsapp_messages").find((m) => m["direction"] === "in")!;
    expect(stored["transcript"]).toBe("tomei o zypred");
  });

  it("falha na transcrição pede para repetir e não confirma", async () => {
    const w = setup();
    w.channel.mediaStore.set("aud2", { data: new Uint8Array([1]), mimeType: "audio/ogg" });
    w.transcriber.next = null;
    await w.deliver([w.msg(PHONES.rosa, { type: "audio", media: { mimeType: "audio/ogg", ref: "aud2" } })]);
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Não consegui ouvir");
    expect(w.movements()).toHaveLength(0);
  });

  it("'Lembrar em 15 min' reagenda o lembrete só para quem pediu", async () => {
    const w = setup();
    await w.tick();
    await w.flushOutbox();
    const before = w.channel.sent.length;
    await w.press(PHONES.rosa, buttonLabelled(w, "Lembrar", 0));
    const snoozed = w.outbox().find((o) => String(o["dedupe_key"]).includes(":snooze:"))!;
    expect(new Date(String(snoozed["next_attempt_at"])).getTime() - DOSE_TIME.getTime()).toBe(15 * 60_000);
    // Antes dos 15 min nada novo além do aviso de combinado.
    expect(w.channel.sent.slice(before).every((m) => m.text.includes("Combinado"))).toBe(true);
    w.advance(16);
    await w.flushOutbox();
    expect(w.channel.sent.some((m) => m.text.includes("Dose atrasada"))).toBe(true);
  });
});

describe("consultas filtradas por permissão", () => {
  it("estoque: Cuidadora e Administrador veem; Confirmador não (sem stock.view)", async () => {
    const w = setup();
    await w.say(PHONES.joao, "como está o estoque?");
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Sem acesso");
    await w.say(PHONES.rosa, "como está o estoque?");
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Zypred");
    expect(w.lastSent()!.text).toContain("estimativa");
  });

  it("próximas doses e status de dose", async () => {
    const w = setup();
    w.advance(-30);
    await w.say(PHONES.ana, "quais as próximas doses?");
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("14:00");
    await w.say(PHONES.ana, "já tomou o zypred?");
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("aguardando");
    await w.press(PHONES.ana, `mc1:dose_taken:${FAMILY_ID}:dose-zyp`);
    await w.say(PHONES.ana, "o adelino já tomou o zypred?");
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("tomada");
  });

  it("intenção desconhecida devolve a ajuda com exemplos", async () => {
    const w = setup();
    await w.say(PHONES.ana, "blablabla");
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Como posso ajudar");
  });
});

describe("Evolution fora do ar", () => {
  it("mensagens ficam na fila, saem quando volta, e o administrador é avisado após N falhas", async () => {
    const w = setup();
    await w.tick();
    w.channel.down = true;
    const down = await w.flushOutbox();
    expect(down.sent).toBe(0);
    const [row] = w.outbox();
    expect(row!["status"]).toBe("failed");
    expect(row!["attempts"]).toBe(1);

    // Mais mensagens na fila + falhas seguidas disparam o alerta operacional e interrompem o lote.
    seedDose(w, "dose-b", "pat-maria", "med-losartana", DOSE_TIME);
    seedDose(w, "dose-c", "pat-maria", "med-losartana", new Date(DOSE_TIME.getTime() + 60_000));
    await w.tick();
    w.advance(60);
    const second = await w.flushOutbox();
    expect(second.providerDown).toBe(true);
    expect(w.monitor.alerts.some((a) => a.kind === "provider_down")).toBe(true);
    expect(w.outbox().every((o) => o["status"] !== "dead")).toBe(true);

    // Volta ao ar: tudo que estava na fila é entregue.
    w.channel.down = false;
    w.advance(60);
    await w.flushOutbox();
    expect(w.outbox().filter((o) => o["status"] === "sent").length).toBeGreaterThan(0);
    expect(w.outbox().some((o) => ["failed", "queued", "sending"].includes(String(o["status"])))).toBe(false);
  });

  it("recusa definitiva (4xx) vai direto para dead e avisa", async () => {
    const w = setup();
    await w.tick();
    w.channel.rejectNext = 1;
    await w.flushOutbox();
    expect(w.outbox()[0]!["status"]).toBe("dead");
    expect(w.monitor.alerts.some((a) => a.kind === "outbox_dead")).toBe(true);
  });

  it("esgotadas as tentativas, a mensagem vira dead", async () => {
    const w = setup();
    w.outboxDeps.config = { maxAttempts: 2, providerDownAfter: 99 };
    await w.tick();
    w.channel.down = true;
    await w.flushOutbox();
    w.advance(60);
    await w.flushOutbox();
    expect(w.outbox()[0]!["status"]).toBe("dead");
  });

  it("lembrete de dose já tomada, preso na fila, é descartado em vez de enviado tarde", async () => {
    const w = setup();
    await w.tick();
    await w.data.update("dose_events", "dose-zyp", { status: "taken" });
    await w.flushOutbox();
    expect(w.channel.sent.filter((m) => m.to === PHONES.rosa)).toHaveLength(0);
    const reminder = w.outbox().find((o) => o["kind"] === "dose_reminder")!;
    expect(reminder["last_error"]).toContain("obsolete");
    expect(w.monitor.alerts).toHaveLength(0);
  });

  it("dedupe_key impede dois registros iguais na fila", async () => {
    const w = setup();
    await w.tick();
    const count = w.outbox().length;
    await w.tick();
    expect(w.outbox()).toHaveLength(count);
  });
});

describe("privacidade", () => {
  it("nenhum log contém telefone, nome, texto de mensagem ou código", async () => {
    const w = setup({ zypredBalance: 60 });
    await w.tick();
    w.channel.down = true;
    await w.flushOutbox();
    w.channel.down = false;
    w.advance(5);
    await w.flushOutbox();
    await w.say(PHONES.stranger, "tomei");
    await w.say(PHONES.rosa, "tomei o zypred do Adelino");
    await w.deliver([w.msg(PHONES.rosa, { type: "audio", media: { mimeType: "audio/ogg", ref: "nada" } })]); // falha de mídia
    await w.deliver([], "sha256=invalida");
    const dump = JSON.stringify(w.logs);
    for (const secret of [...Object.values(PHONES), "5511", "Adelino", "Maria", "Rosa", "Zypred", "tomei", "Ana"]) {
      expect(dump).not.toContain(secret);
    }
    expect(w.logs.length).toBeGreaterThan(0);
  });
});
