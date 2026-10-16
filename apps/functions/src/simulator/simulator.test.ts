import { describe, expect, it } from "vitest";
import { runReminderScenario, WhatsAppSimulator } from "./simulator";

describe("simulador local", () => {
  it("roteiro completo: lembrete → Tomei → desconto → alerta de estoque", async () => {
    const { steps, sim } = await runReminderScenario();
    const text = steps.join("\n");
    expect(text).toContain("Hora do remédio");
    expect(text).toContain("[1] Tomei");
    expect(text).toContain("Anotado");
    expect(sim.world.movements().length).toBeGreaterThanOrEqual(1);
    // 14:00 de Zypred = 1 gota; 59/4 = 14 dias → atenção → Ana é avisada.
    expect(text).toContain("Estoque baixo");
    expect(text).toContain("Ana");
  });

  it("áudio e botão pelo simulador", async () => {
    const sim = new WhatsAppSimulator();
    await sim.tick();
    sim.drain();
    await sim.audio("rosa", "tomei o zypred do adelino");
    expect(sim.drain().some((m) => m.text.includes("Anotado"))).toBe(true);
  });

  it("número desconhecido não recebe nada", async () => {
    const sim = new WhatsAppSimulator();
    await sim.say("estranho", "oi");
    expect(sim.drain()).toHaveLength(0);
  });
});
