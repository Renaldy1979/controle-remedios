import { describe, expect, it, vi } from "vitest";
import { MetaCloudAdapter } from "./meta-cloud";
import { decodeButtonId, encodeButtonId } from "./buttons";
import { ChannelError } from "./errors";
import { EvolutionAdapter } from "./evolution";
import { normalizePhone, phoneVariants } from "./phone";
import { renderTemplate } from "./templates";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("telefone", () => {
  it("normaliza JIDs e números brasileiros", () => {
    expect(normalizePhone("5511999998888@s.whatsapp.net")).toBe("+5511999998888");
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

describe("EvolutionAdapter", () => {
  const cfg = { baseUrl: "https://evo.test/", apiKey: "k", instance: "inst" };

  it("envia texto e devolve o id do provedor", async () => {
    const fetchFn = vi.fn(async () => json({ key: { id: "ABC" } }));
    const a = new EvolutionAdapter({ ...cfg, fetch: fetchFn as never });
    await expect(a.sendText("+5511999998888", "oi")).resolves.toEqual({ providerMessageId: "ABC" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.test/message/sendText/inst");
    expect(JSON.parse(init.body as string)).toEqual({ number: "5511999998888", text: "oi" });
  });

  it("erro de rede e 5xx são retentáveis; 4xx é definitivo", async () => {
    const down = new EvolutionAdapter({ ...cfg, fetch: (async () => { throw new Error("ECONNREFUSED"); }) as never });
    await expect(down.sendText("+5511999998888", "x")).rejects.toMatchObject({ retryable: true });
    const s503 = new EvolutionAdapter({ ...cfg, fetch: (async () => json({}, 503)) as never });
    await expect(s503.sendText("+5511999998888", "x")).rejects.toMatchObject({ retryable: true, status: 503 });
    const s400 = new EvolutionAdapter({ ...cfg, fetch: (async () => json({}, 400)) as never });
    const err = await s400.sendText("+5511999998888", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChannelError);
    expect((err as ChannelError).retryable).toBe(false);
    expect((err as ChannelError).message).not.toContain("5511");
  });

  it("monta botões de resposta e de ligação", async () => {
    const fetchFn = vi.fn(async () => json({ key: { id: "B1" } }));
    const a = new EvolutionAdapter({ ...cfg, fetch: fetchFn as never });
    await a.sendButtons("+5511999998888", {
      text: "t",
      buttons: [
        { id: "x", label: "Tomei" },
        { id: "c", label: "Ligar", kind: "call", phone: "+5511988887777" },
      ],
    });
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.buttons[0]).toEqual({ type: "reply", displayText: "Tomei", id: "x" });
    expect(body.buttons[1].type).toBe("call");
  });

  const upsert = (message: unknown, key: Record<string, unknown> = {}) => ({
    event: "messages.upsert",
    data: { key: { remoteJid: "5511999998888@s.whatsapp.net", fromMe: false, id: "M1", ...key }, messageTimestamp: 1760000000, message },
  });
  const adapter = new EvolutionAdapter(cfg);

  it("interpreta texto, botão, áudio e ignora mensagens próprias e outros eventos", () => {
    expect(adapter.parseInbound(upsert({ conversation: "tomei" }))[0]).toMatchObject({ type: "text", text: "tomei", from: "+5511999998888" });
    expect(adapter.parseInbound(upsert({ buttonsResponseMessage: { selectedButtonId: "mc1:dose_taken:f:d" } }))[0]).toMatchObject({
      type: "button",
      buttonId: "mc1:dose_taken:f:d",
    });
    expect(adapter.parseInbound(upsert({ audioMessage: { mimetype: "audio/ogg; codecs=opus" } }))[0]).toMatchObject({ type: "audio" });
    expect(adapter.parseInbound(upsert({ conversation: "x" }, { fromMe: true }))).toEqual([]);
    expect(adapter.parseInbound({ event: "connection.update", data: {} })).toEqual([]);
    expect(adapter.parseInbound("lixo")).toEqual([]);
  });

  it("em grupo, o remetente é o participante", () => {
    const [m] = adapter.parseInbound(
      upsert({ conversation: "oi" }, { remoteJid: "1203@g.us", participant: "5511977776666@s.whatsapp.net" }),
    );
    expect(m).toMatchObject({ groupId: "1203@g.us", from: "+5511977776666" });
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
    const r = renderTemplate("dose_reminder", {
      familyId: "fam1", doseEventId: "d1", patientName: "Adelino", medicationName: "Zypred", doseText: "1 gota", time: "14:00",
    });
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
  });
  it("todo rótulo de botão cabe em 20 caracteres", () => {
    const r = renderTemplate("dose_choose", {
      familyId: "f",
      moreCount: 0,
      options: [{ doseEventId: "d", patientName: "Maria", medicationName: "Sinvastatina 20mg comprimido", time: "08:00" }],
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
});
