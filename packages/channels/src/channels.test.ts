import { describe, expect, it, vi } from "vitest";
import { MetaCloudAdapter } from "./meta-cloud";
import { decodeButtonId, encodeButtonId } from "./buttons";
import { ChannelError } from "./errors";
import { EvolutionGoAdapter, extractDownloadedMedia, extractSentMessageId } from "./evolution-go";
import { createChannelFromEnv } from "./factory";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeChannel, lastLoginCode, readFakeChannelLog } from "./fake";
import { degradeContent, numberedOptions, renderNumbered } from "./options";
import { normalizePhone, phoneVariants } from "./phone";
import { renderTemplate } from "./templates";
import { sendContent } from "./types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("telefone", () => {
  it("normaliza JIDs e números brasileiros", () => {
    expect(normalizePhone("5511999998888@s.whatsapp.net")).toBe("+5511999998888");
    expect(normalizePhone("5511999998888:38@s.whatsapp.net")).toBe("+5511999998888");
    expect(normalizePhone("(11) 99999-8888")).toBe("+5511999998888");
    expect(normalizePhone("abc")).toBeNull();
  });
  it("gera variantes com e sem o nono dígito", () => {
    expect(phoneVariants("+5511999998888")).toEqual(["+5511999998888", "+551199998888"]);
    expect(phoneVariants("+551199998888")).toEqual(["+5511999998888", "+551199998888"]);
  });
});

describe("botões", () => {
  it("codifica e decodifica o id com família e referência", () => {
    const id = encodeButtonId("dose_taken", "fam1", "dose:9");
    expect(decodeButtonId(id)).toEqual({ action: "dose_taken", familyId: "fam1", ref: "dose:9" });
    expect(decodeButtonId("qualquer")).toBeNull();
    expect(decodeButtonId("mc1:hack:fam:1")).toBeNull();
  });
});

const reminder = () =>
  renderTemplate("dose_reminder", { familyId: "fam1", doseEventId: "d1", patientName: "Adelino", medicationName: "Zypred", doseText: "1 gota", time: "14:00" });
const missed = () =>
  renderTemplate("dose_missed_family", { familyId: "f", doseEventId: "d", patientName: "Adelino", medicationName: "Zypred", time: "14:00", callPhone: "+5511988887777" });

describe("opções numeradas (mesma definição dos botões)", () => {
  it("lembrete: 1 = Tomei, 2 = Lembrar", () => {
    const text = renderNumbered(reminder());
    expect(text).toContain("Adelino");
    expect(text).toContain("*1* — Tomei");
    expect(text).toContain("*2* — Lembrar em 15 min");
    expect(numberedOptions(reminder().buttons).map((b) => b.label)).toEqual(["Tomei", "Lembrar em 15 min"]);
  });
  it("ligação nunca vira opção numerada: vira linha de texto", () => {
    const text = renderNumbered(missed());
    expect(text).toContain("📞 Ligar: +5511988887777");
    expect(text).toContain("*1* — Já tomou");
    expect(text).not.toContain("*2*");
    expect(numberedOptions(missed().buttons)).toHaveLength(1);
  });
  it("com botões reais o conteúdo não muda; sem botões nada a degradar", () => {
    expect(degradeContent(reminder(), true)).toEqual(reminder());
    expect(degradeContent({ text: "oi" }, false)).toEqual({ text: "oi" });
  });
  it("mídia com opções leva o texto numerado na legenda", () => {
    const c = degradeContent({ text: "t", buttons: reminder().buttons!, media: { url: "https://x", mimeType: "image/jpeg" } }, false);
    expect(c.buttons).toBeUndefined();
    expect(c.media?.caption).toContain("*1*");
  });
  it("sendContent usa texto numerado quando o canal não suporta botões, e botões quando suporta", async () => {
    const off = new FakeChannel();
    off.supportsButtons = false;
    await sendContent(off, "+5511999998888", reminder());
    expect(off.sent[0]!.buttons).toBeUndefined();
    expect(off.sent[0]!.text).toContain("*1* — Tomei");
    const on = new FakeChannel();
    await sendContent(on, "+5511999998888", reminder());
    expect(on.sent[0]!.buttons).toHaveLength(2);
    const grp = new FakeChannel();
    grp.supportsButtons = false;
    await grp.sendToGroup("1203@g.us", reminder());
    expect(grp.sent[0]!.text).toContain("*2* — Lembrar");
  });
});

describe("EvolutionGoAdapter — envio", () => {
  const cfg = { baseUrl: "https://evo.test/", apiKey: "k", instanceId: "inst-uuid" };
  const bodyOf = (fn: ReturnType<typeof vi.fn>, i = 0) => JSON.parse((fn.mock.calls[i] as unknown as [string, RequestInit])[1].body as string);

  it("texto: rota, cabeçalhos apikey+instanceId e número só com dígitos", async () => {
    const fetchFn = vi.fn(async () => json({ success: true, messageId: "ABC" }));
    const a = new EvolutionGoAdapter({ ...cfg, fetch: fetchFn as never });
    await expect(a.sendText("+5511999998888", "oi")).resolves.toEqual({ providerMessageId: "ABC" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.test/send/text");
    expect(init.headers).toMatchObject({ apikey: "k", instanceId: "inst-uuid" });
    expect(bodyOf(fetchFn)).toEqual({ number: "5511999998888", text: "oi" });
  });

  it("id da resposta: aceita messageId ou data.Info.ID; sem id, gera um e NÃO falha (já foi enviado)", async () => {
    expect(extractSentMessageId({ data: { Info: { ID: "3EB0" } } })).toBe("3EB0");
    expect(extractSentMessageId({ messageId: "M" })).toBe("M");
    expect(extractSentMessageId({})).toBeUndefined();
    const a = new EvolutionGoAdapter({ ...cfg, fetch: (async () => json({ success: true })) as never });
    expect((await a.sendText("+5511999998888", "x")).providerMessageId).toMatch(/^evgo-/);
  });

  it("padrão sem botões: sendButtons envia texto numerado em /send/text", async () => {
    const fetchFn = vi.fn(async () => json({ messageId: "T" }));
    const a = new EvolutionGoAdapter({ ...cfg, fetch: fetchFn as never });
    expect(a.supportsButtons).toBe(false);
    await sendContent(a, "+5511999998888", reminder());
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("/send/text");
    expect(bodyOf(fetchFn).text).toContain("*1* — Tomei");
  });

  it("com botões: /send/button só com reply; ligação vira texto (não mistura reply com call)", async () => {
    const fetchFn = vi.fn(async () => json({ messageId: "B1" }));
    const a = new EvolutionGoAdapter({ ...cfg, supportsButtons: true, fetch: fetchFn as never });
    await sendContent(a, "+5511999998888", missed());
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("/send/button");
    const body = bodyOf(fetchFn);
    expect(body.buttons).toEqual([{ type: "reply", displayText: "Já tomou", id: expect.stringContaining("mc1:dose_taken") }]);
    expect(body.buttons.every((b: { type: string }) => b.type === "reply")).toBe(true);
    expect(body.description).toContain("📞 Ligar: +5511988887777");
    expect(body).toMatchObject({ title: expect.any(String), footer: expect.any(String) }); // obrigatórios no swagger
  });

  it("mídia e grupo", async () => {
    const fetchFn = vi.fn(async () => json({ messageId: "M" }));
    const a = new EvolutionGoAdapter({ ...cfg, fetch: fetchFn as never });
    await a.sendMedia("+5511999998888", { url: "https://x/y.jpg", mimeType: "image/jpeg", caption: "c" });
    expect(bodyOf(fetchFn)).toMatchObject({ number: "5511999998888", type: "image", url: "https://x/y.jpg", caption: "c" });
    await a.sendToGroup("1203@g.us", { text: "olá" });
    expect(bodyOf(fetchFn, 1)).toEqual({ number: "1203@g.us", text: "olá" });
  });

  it("erro de rede e 5xx são retentáveis; 4xx é definitivo e a mensagem não vaza telefone", async () => {
    const down = new EvolutionGoAdapter({ ...cfg, fetch: (async () => { throw new Error("ECONNREFUSED"); }) as never });
    await expect(down.sendText("+5511999998888", "x")).rejects.toMatchObject({ retryable: true });
    const s503 = new EvolutionGoAdapter({ ...cfg, fetch: (async () => json({}, 503)) as never });
    await expect(s503.sendText("+5511999998888", "x")).rejects.toMatchObject({ retryable: true, status: 503 });
    const s400 = new EvolutionGoAdapter({ ...cfg, fetch: (async () => json({}, 400)) as never });
    const err = await s400.sendText("+5511999998888", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as ChannelError).retryable).toBe(false);
    expect((err as ChannelError).message).not.toContain("5511");
  });
});

describe("EvolutionGoAdapter — entrada (fixtures no formato da documentação)", () => {
  const adapter = new EvolutionGoAdapter({ baseUrl: "https://evo.test", apiKey: "k", instanceId: "i" });
  const event = (info: Record<string, unknown>, message: unknown, extra: Record<string, unknown> = {}) => ({
    event: "Message",
    instanceId: "i",
    data: {
      Info: { Chat: "557499879409@s.whatsapp.net", Sender: "557499879409:38@s.whatsapp.net", IsFromMe: false, IsGroup: false, ID: "3EB0C05F", Type: "text", Timestamp: "2024-10-10T17:17:44-03:00", MediaType: "", ...info },
      Message: message,
      ...extra,
    },
  });

  it("texto", () => {
    const [m] = adapter.parseInbound(event({}, { conversation: "tomei" }));
    expect(m).toMatchObject({ type: "text", text: "tomei", from: "+557499879409", providerMessageId: "3EB0C05F" });
    expect(m!.receivedAt.toISOString()).toBe("2024-10-10T20:17:44.000Z");
    expect(adapter.parseInbound(event({}, { extendedTextMessage: { text: "ok" } }))[0]).toMatchObject({ text: "ok" });
  });

  it("áudio com base64 inline e com referência para /message/downloadmedia", async () => {
    const withB64 = adapter.parseInbound(event({ Type: "media", MediaType: "audio" }, { audioMessage: { mimetype: "audio/ogg; codecs=opus", ptt: true }, base64: "AQID" }))[0]!;
    expect(withB64).toMatchObject({ type: "audio", media: { base64: "AQID", mimeType: "audio/ogg; codecs=opus" } });
    expect([...(await adapter.fetchMedia(withB64)).data]).toEqual([1, 2, 3]);

    const fetchFn = vi.fn(async () => json({ data: { base64: "BAUG", mimetype: "audio/ogg" } }));
    const a2 = new EvolutionGoAdapter({ baseUrl: "https://evo.test", apiKey: "k", instanceId: "i", fetch: fetchFn as never });
    const noB64 = a2.parseInbound(event({ Type: "media", MediaType: "audio" }, { audioMessage: { mimetype: "audio/ogg" } }))[0]!;
    expect([...(await a2.fetchMedia(noB64)).data]).toEqual([4, 5, 6]);
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("/message/downloadmedia");
    expect(extractDownloadedMedia({ nada: 1 })).toBeNull();
  });

  it("grupo: Chat é o grupo e o remetente vem de Sender; LID usa SenderAlt", () => {
    const [m] = adapter.parseInbound(event({ Chat: "1203630@g.us", IsGroup: true, Sender: "99887766@lid", SenderAlt: "557499879409@s.whatsapp.net" }, { conversation: "oi" }));
    expect(m).toMatchObject({ groupId: "1203630@g.us", from: "+557499879409" });
    expect(adapter.parseInbound(event({ Sender: "99887766@lid", SenderAlt: "1@lid" }, { conversation: "oi" }))).toEqual([]);
  });

  it("resposta de botão (modo botões) em qualquer grafia do whatsmeow", () => {
    expect(adapter.parseInbound(event({}, { buttonsResponseMessage: { selectedButtonID: "mc1:dose_taken:f:d" } }))[0]).toMatchObject({ type: "button", buttonId: "mc1:dose_taken:f:d" });
    expect(adapter.parseInbound(event({}, { templateButtonReplyMessage: { selectedId: "mc1:dose_snooze:f:d" } }))[0]).toMatchObject({ buttonId: "mc1:dose_snooze:f:d" });
  });

  it("ignora mensagens próprias, outros eventos e lixo", () => {
    expect(adapter.parseInbound(event({ IsFromMe: true }, { conversation: "x" }))).toEqual([]);
    expect(adapter.parseInbound({ event: "Receipt", data: {} })).toEqual([]);
    expect(adapter.parseInbound({ event: "Message", data: { Info: {} } })).toEqual([]);
    expect(adapter.parseInbound("lixo")).toEqual([]);
  });
});

describe("fábrica por configuração", () => {
  const base = { EVOLUTION_BASE_URL: "https://e", EVOLUTION_API_KEY: "k", EVOLUTION_INSTANCE_ID: "i" };
  it("Evolution Go por padrão, sem botões; SUPPORTS_BUTTONS liga", () => {
    const a = createChannelFromEnv(base);
    expect([a.name, a.supportsButtons]).toEqual(["evolution-go", false]);
    expect(createChannelFromEnv({ ...base, SUPPORTS_BUTTONS: "true" }).supportsButtons).toBe(true);
  });
  it("trocar para Meta é só configuração", () => {
    const a = createChannelFromEnv({ CHANNEL_PROVIDER: "meta-cloud", META_ACCESS_TOKEN: "t", META_PHONE_NUMBER_ID: "1" });
    expect([a.name, a.supportsButtons]).toEqual(["meta-cloud", true]);
    expect(() => createChannelFromEnv({ CHANNEL_PROVIDER: "outro" })).toThrow();
    expect(() => createChannelFromEnv({})).toThrow("EVOLUTION_BASE_URL");
  });
});

describe("canal falso persistido (e2e)", () => {
  it("grava os envios e devolve o último código de login por telefone", async () => {
    const file = join(tmpdir(), `fake-channel-${process.pid}-${Date.now()}.jsonl`);
    const ch = createChannelFromEnv({ CHANNEL_PROVIDER: "fake", FAKE_CHANNEL_FILE: file });
    await ch.sendText("+5511999990001", renderTemplate("login_code", { code: "111111", minutes: 10 }).text);
    await ch.sendText("+5511999990002", renderTemplate("login_code", { code: "222222", minutes: 10 }).text);
    await ch.sendText("+5511999990001", renderTemplate("login_code", { code: "333333", minutes: 10 }).text);
    expect(lastLoginCode("+5511999990001", readFakeChannelLog(file))).toBe("333333");
    expect(lastLoginCode("+5511999990002", readFakeChannelLog(file))).toBe("222222");
    expect(lastLoginCode("+5511900000000", readFakeChannelLog(file))).toBeNull();
    rmSync(file);
  });
  it("não é permitido em produção", () => {
    expect(() => createChannelFromEnv({ CHANNEL_PROVIDER: "fake", NODE_ENV: "production" })).toThrow();
  });
});

describe("MetaCloudAdapter", () => {
  it("interpreta entrada de texto e botão", () => {
    const a = new MetaCloudAdapter({ accessToken: "t", phoneNumberId: "1" });
    const out = a.parseInbound({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: "w1", from: "5511999998888", timestamp: "1760000000", type: "text", text: { body: "oi" } },
                  { id: "w2", from: "5511999998888", timestamp: "1760000001", type: "interactive", interactive: { button_reply: { id: "mc1:dose_taken:f:d" } } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out.map((m) => m.type)).toEqual(["text", "button"]);
  });
  it("grupos não são suportados", async () => {
    const a = new MetaCloudAdapter({ accessToken: "t", phoneNumberId: "1" });
    await expect(a.sendToGroup("g", { text: "x" })).rejects.toMatchObject({ retryable: false });
  });
});

describe("templates pt-BR", () => {
  it("lembrete: nome do paciente, uma ação por botão, ids com família", () => {
    const r = reminder();
    expect(r.text).toContain("Adelino");
    expect(r.buttons?.map((b) => b.label)).toEqual(["Tomei", "Lembrar em 15 min"]);
    expect(decodeButtonId(r.buttons![0]!.id)).toMatchObject({ action: "dose_taken", ref: "d1" });
  });
  it("estoque baixo: botões da especificação e aviso de estimativa", () => {
    const r = renderTemplate("low_stock", {
      familyId: "f", replenishmentId: "r1", patientName: "Adelino", medicationName: "Zypred", daysLeft: 6, level: "critical", isEstimate: true,
    });
    expect(r.buttons?.map((b) => b.label)).toEqual(["Eu cuido disso", "Ver receita"]);
    expect(r.text).toContain("estimativa");
    expect(r.text).toContain("6 dias");
    expect(renderNumbered(r)).toContain("*2* — Ver receita");
  });
  it("todo rótulo de botão cabe em 20 caracteres", () => {
    const r = renderTemplate("dose_choose", {
      familyId: "f",
      moreCount: 0,
      options: [{ doseEventId: "d", patientName: "Maria Aparecida", medicationName: "Sinvastatina 20mg comprimido", time: "08:00" }],
    });
    expect(r.buttons![0]!.label.length).toBeLessThanOrEqual(20);
  });
  it("dose esquecida usa botão de ligar só com telefone", () => {
    const base = { familyId: "f", doseEventId: "d", patientName: "Adelino", medicationName: "Zypred", time: "14:00" };
    expect(renderTemplate("dose_missed_family", base).buttons).toHaveLength(1);
    expect(renderTemplate("dose_missed_family", { ...base, callPhone: "+5511988887777" }).buttons).toHaveLength(2);
  });
  it("receita compartilhada avisa acesso restrito; código de login mostra o código", () => {
    const r = renderTemplate("prescription_shared", {
      familyId: "f", prescriptionId: "p", patientName: "Adelino", medications: ["Zypred"], imageUrl: "https://x/y", mimeType: "image/jpeg", validUntil: "25/10/2026",
    });
    expect(r.text).toContain("Acesso restrito");
    expect(r.media?.url).toBe("https://x/y");
    expect(renderTemplate("login_code", { code: "123456", minutes: 10 }).text).toContain("123456");
  });
  it("resumo diário lista pacientes e estoque crítico", () => {
    const r = renderTemplate("daily_summary", {
      date: "15/10/2026",
      patients: [{ name: "Adelino", taken: 7, missed: 1, pending: 0 }],
      criticalStock: [{ patientName: "Adelino", medicationName: "Zypred", daysLeft: 3, isEstimate: true }],
      openReplenishments: 1,
    });
    expect(r.text).toContain("Resumo do dia");
    expect(r.text).toContain("Zypred");
  });
  it("todo template com botões tem versão numerada coerente com as mesmas opções", () => {
    const withButtons = [reminder(), missed()];
    for (const r of withButtons) {
      const opts = numberedOptions(r.buttons);
      const text = renderNumbered(r);
      opts.forEach((b, i) => expect(text).toContain(`*${i + 1}* — ${b.label}`));
    }
  });
});
