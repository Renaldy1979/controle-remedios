import type { SentRecord } from "@medcuidar/channels";
import { buildWorld, FAMILY_ID, PHONES, SECRET, type World, type WorldOptions } from "../testing/world";

/** Simulador local de WhatsApp: celulares falsos sobre o mesmo pipeline real (webhook, outbox, agendador). */
export const PERSONAS = {
  ana: { name: "Ana (administradora)", phone: PHONES.ana },
  rosa: { name: "Rosa (cuidadora)", phone: PHONES.rosa },
  joao: { name: "Seu João (confirmador)", phone: PHONES.joao },
  estranho: { name: "Número desconhecido", phone: PHONES.stranger },
} as const;
export type PersonaKey = keyof typeof PERSONAS;

export class WhatsAppSimulator {
  readonly world: World;
  private cursor = 0;

  constructor(opts: WorldOptions = {}) {
    this.world = buildWorld({ withTreatments: true, ...opts });
  }

  get webhookSecret() {
    return SECRET;
  }
  get familyId() {
    return FAMILY_ID;
  }

  personaOf(phone: string): string {
    return Object.values(PERSONAS).find((p) => p.phone === phone)?.name ?? phone;
  }

  /** Mensagens que o "provedor" entregou desde a última leitura. */
  drain(): SentRecord[] {
    const out = this.world.channel.sent.slice(this.cursor);
    this.cursor = this.world.channel.sent.length;
    return out;
  }

  async say(who: PersonaKey, text: string) {
    const res = await this.world.say(PERSONAS[who].phone, text);
    await this.world.flushOutbox();
    return res;
  }

  /** Toca no botão `index` (1-based) da última mensagem que `who` recebeu. */
  async tap(who: PersonaKey, index: number) {
    const phone = PERSONAS[who].phone;
    const last = [...this.world.channel.sent].reverse().find((m) => m.to === phone && m.buttons?.length);
    const button = last?.buttons?.[index - 1];
    if (!button) throw new Error("Nenhum botão com esse número na última mensagem.");
    const res = await this.world.press(phone, button.id);
    await this.world.flushOutbox();
    return res;
  }

  async audio(who: PersonaKey, transcript: string) {
    const ref = `aud-${Date.now()}-${Math.random()}`;
    this.world.channel.mediaStore.set(ref, { data: new Uint8Array([0]), mimeType: "audio/ogg" });
    this.world.transcriber.next = transcript;
    const res = await this.world.deliver([this.world.msg(PERSONAS[who].phone, { type: "audio", media: { mimeType: "audio/ogg", ref } })]);
    await this.world.flushOutbox();
    return res;
  }

  async tick() {
    const report = await this.world.tick();
    await this.world.flushOutbox();
    return report;
  }

  advance(minutes: number) {
    this.world.advance(minutes);
  }

  format(m: SentRecord): string {
    const dest = m.isGroup ? "Grupo da família" : this.personaOf(m.to);
    const buttons = m.buttons?.length ? `\n   ${m.buttons.map((b, i) => `[${i + 1}] ${b.label}`).join("  ")}` : "";
    return `→ ${dest}\n${m.text
      .split("\n")
      .map((l) => `   ${l}`)
      .join("\n")}${buttons}`;
  }
}

/** Roteiro: lembrete → "Tomei" → desconto → alerta de estoque baixo. Devolve o que cada passo produziu. */
export async function runReminderScenario(
  sim = new WhatsAppSimulator({ zypredBalance: 60, now: new Date("2026-10-15T10:45:00.000Z") }), // 07:45 em São Paulo
): Promise<{ steps: string[]; sim: WhatsAppSimulator }> {
  const steps: string[] = [];
  const show = (title: string) => {
    steps.push(`# ${title}`, ...sim.drain().map((m) => sim.format(m)));
  };
  await sim.tick(); // 07:45 — gera as doses do dia
  sim.advance(15);
  await sim.tick();
  show("08:00 — agendador envia o lembrete");
  await sim.tap("rosa", 1); // Tomei
  show('Rosa toca em "Tomei"');
  return { steps, sim };
}
