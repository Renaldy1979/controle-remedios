import { describe, expect, it } from "vitest";
import { handleWhatsappInbound } from "./inbound/handler";
import { interpretText, parseOption } from "./inbound/interpret";
import { buildWorld, PHONES, seedDose } from "./testing/world";

const DOSE_TIME = new Date("2026-10-15T17:00:00.000Z");

/** Mundo no modo padrão de produção: Evolution Go sem botões (texto numerado). */
function numbered(two = false) {
  const w = buildWorld();
  w.channel.supportsButtons = false;
  seedDose(w, "dose-zyp", "pat-adelino", "med-zypred", DOSE_TIME);
  if (two) seedDose(w, "dose-los", "pat-maria", "med-losartana", DOSE_TIME);
  return w;
}
const toRosa = (w: ReturnType<typeof numbered>) => w.channel.sent.filter((m) => m.to === PHONES.rosa);

describe("modo texto numerado (padrão)", () => {
  it("lembrete sai como texto com opções, sem botões; '1' confirma e desconta uma vez", async () => {
    const w = numbered();
    await w.tick();
    await w.flushOutbox();
    const r = toRosa(w)[0]!;
    expect(r.buttons).toBeUndefined();
    expect(r.text).toContain("Adelino");
    expect(r.text).toContain("*1* — Tomei");
    expect(r.text).toContain("*2* — Lembrar em 15 min");

    await w.say(PHONES.rosa, "1");
    expect(w.movements()).toHaveLength(1);
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("taken");
    // Repetir "1" não desconta de novo: a dose já foi resolvida.
    await w.say(PHONES.rosa, "1");
    expect(w.movements()).toHaveLength(1);
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Nenhuma dose pendente");
  });

  it("'2' reagenda o lembrete", async () => {
    const w = numbered();
    await w.tick();
    await w.flushOutbox();
    await w.say(PHONES.rosa, "2");
    expect(w.outbox().some((o) => String(o["dedupe_key"]).includes(":snooze:"))).toBe(true);
    expect(w.movements()).toHaveLength(0);
  });

  it("opção que não existe não faz nada", async () => {
    const w = numbered();
    await w.tick();
    await w.flushOutbox();
    await w.say(PHONES.rosa, "7");
    expect(w.movements()).toHaveLength(0);
    expect(w.domain.confirmCalls).toBe(0);
  });

  it("'1' sem nenhuma pergunta recente não é adivinhado", async () => {
    const w = numbered();
    await w.say(PHONES.rosa, "1");
    expect(w.domain.confirmCalls).toBe(0);
    await w.flushOutbox();
    expect(w.lastSent()!.text).toContain("Como posso ajudar");
  });

  it("duas doses pendentes: '1' pergunta com lista numerada e só a escolha seguinte confirma", async () => {
    const w = numbered(true);
    await w.tick();
    await w.flushOutbox();
    expect(toRosa(w)).toHaveLength(2);

    await w.say(PHONES.rosa, "1");
    expect(w.domain.confirmCalls).toBe(0); // nunca adivinha
    await w.flushOutbox();
    const ask = w.lastSent()!;
    expect(ask.text).toContain("Qual dose");
    expect(ask.text).toContain("*1* — Adelino · Zypred");
    expect(ask.text).toContain("*2* — Maria · Losartana");

    await w.say(PHONES.rosa, "2");
    expect(w.domain.confirmCalls).toBe(1);
    expect((await w.data.get("dose_events", "dose-los"))["status"]).toBe("taken");
    expect((await w.data.get("dose_events", "dose-zyp"))["status"]).toBe("pending");
  });

  it.each(["tomei", "ok", "já tomou", "👍", "✅", "Feito!"])("'%s' confirma a única dose pendente", async (text) => {
    const w = numbered();
    await w.say(PHONES.rosa, text);
    expect(w.movements()).toHaveLength(1);
  });

  it.each(["ok", "👍", "já tomou"])("'%s' com duas pendentes pergunta com opções numeradas", async (text) => {
    const w = numbered(true);
    await w.say(PHONES.rosa, text);
    await w.flushOutbox();
    expect(w.domain.confirmCalls).toBe(0);
    expect(w.lastSent()!.text).toContain("*1* —");
    expect(w.lastSent()!.buttons).toBeUndefined();
  });

  it("áudio transcrito como 'tomei' segue o mesmo caminho", async () => {
    const w = numbered();
    w.channel.mediaStore.set("a", { data: new Uint8Array([1]), mimeType: "audio/ogg" });
    w.transcriber.next = "já tomou";
    await w.deliver([w.msg(PHONES.rosa, { type: "audio", media: { mimeType: "audio/ogg", ref: "a" } })]);
    expect(w.movements()).toHaveLength(1);
  });

  it("aviso à família de dose esquecida: ligação em texto e '1' = Já tomou", async () => {
    const w = numbered();
    await w.tick();
    w.advance(120);
    await w.tick();
    await w.flushOutbox();
    const warn = w.channel.sent.find((m) => m.to === PHONES.ana && m.text.includes("Dose esquecida"))!;
    expect(warn.text).toContain("📞 Ligar: +5511999990002");
    expect(warn.text).toContain("*1* — Já tomou");
    expect(warn.buttons).toBeUndefined();
  });

  it("resposta numerada no grupo identifica quem respondeu pelo telefone", async () => {
    const w = buildWorld({ settings: { whatsapp_group_id: "120363@g.us" } });
    w.channel.supportsButtons = false;
    seedDose(w, "dose-zyp", "pat-adelino", "med-zypred", new Date("2026-10-15T14:00:00.000Z"), "pending");
    await w.tick(); // dose esquecida -> aviso ao grupo
    await w.flushOutbox();
    const toGroup = w.channel.sent.find((m) => m.isGroup && m.text.includes("Dose esquecida"))!;
    expect(toGroup.text).toContain("*1* — Já tomou");
    await w.say(PHONES.stranger, "1", "120363@g.us");
    expect(w.domain.confirmCalls).toBe(0);
  });
});

describe("interpretação", () => {
  it("opções e confirmações curtas", () => {
    expect(parseOption("1")).toBe(1);
    expect(parseOption(" 2. ")).toBe(2);
    expect(parseOption("12")).toBeNull();
    expect(parseOption("tomei 1")).toBeNull();
    for (const t of ["ok", "OK", "👍🏽", "✅", "✔️", "feito", "já tomou", "tomei"]) expect(interpretText(t)).toBe("dose_taken");
    expect(interpretText("ok, e o estoque?")).toBe("stock_status");
    expect(interpretText("ainda não tomou")).toBe("not_taken");
  });
});

describe("autenticação do webhook para o N8N", () => {
  it("aceita o segredo compartilhado no cabeçalho (credencial Header Auth), e recusa errado", async () => {
    const w = numbered();
    const rawBody = JSON.stringify({ provider: "evolution-go", payload: [w.msg(PHONES.rosa, { text: "tomei" })] });
    const bad = await handleWhatsappInbound(w.inboundDeps, { rawBody, headers: { "x-medcuidar-secret": "errado" } });
    expect(bad.status).toBe(401);
    const ok = await handleWhatsappInbound(w.inboundDeps, { rawBody, headers: { "x-medcuidar-secret": "segredo-de-teste" } });
    expect(ok.status).toBe(200);
    expect(w.movements()).toHaveLength(1);
  });
});
