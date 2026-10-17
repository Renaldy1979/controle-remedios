/**
 * Teste de fumaça do canal REAL: envia uma mensagem de cada tipo para UM número informado.
 *
 *   SMOKE_TO=+5511999998888 SMOKE_CONFIRM=ENVIAR pnpm --filter @medcuidar/channels smoke
 *
 * Sem SMOKE_CONFIRM=ENVIAR não envia nada (só mostra o plano). Use SEMPRE um número de teste,
 * nunca o número real dos pacientes. Variáveis do canal: ver .env.example (EVOLUTION_*, SUPPORTS_BUTTONS).
 * Opcionais: SMOKE_GROUP_ID (testa grupo), SMOKE_MEDIA_URL (testa mídia por URL).
 */
import { createChannelFromEnv, normalizePhone, renderTemplate, sendContent } from "../src";

const out = (line: string) => process.stdout.write(`${line}\n`);

async function main() {
  const to = normalizePhone(process.env["SMOKE_TO"] ?? "");
  if (!to) {
    out("Defina SMOKE_TO com o telefone de TESTE (ex.: +5511999998888).");
    process.exitCode = 1;
    return;
  }
  const channel = createChannelFromEnv(process.env);
  const familyId = "smoke";
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["texto", () => channel.sendText(to, "MedCuidar: teste de fumaça (texto).")],
    [
      channel.supportsButtons ? "botões" : "opções numeradas",
      () =>
        sendContent(
          channel,
          to,
          renderTemplate("dose_reminder", { familyId, doseEventId: "smoke-dose", patientName: "Paciente Teste", medicationName: "Remédio Teste", doseText: "1 gota", time: "14:00" }),
        ),
    ],
    [
      "aviso com ligação",
      () =>
        sendContent(
          channel,
          to,
          renderTemplate("dose_missed_family", { familyId, doseEventId: "smoke-dose", patientName: "Paciente Teste", medicationName: "Remédio Teste", time: "14:00", callPhone: to }),
        ),
    ],
  ];
  if (process.env["SMOKE_MEDIA_URL"]) {
    const url = process.env["SMOKE_MEDIA_URL"];
    steps.push(["mídia", () => channel.sendMedia(to, { url, mimeType: "image/jpeg", caption: "MedCuidar: teste de mídia." })]);
  }
  if (process.env["SMOKE_GROUP_ID"]) {
    const group = process.env["SMOKE_GROUP_ID"];
    steps.push(["grupo", () => channel.sendToGroup(group, { text: "MedCuidar: teste de fumaça (grupo)." })]);
  }

  out(`Canal: ${channel.name} · botões reais: ${channel.supportsButtons ? "sim" : "não (texto numerado)"}`);
  out(`Plano: ${steps.map(([n]) => n).join(", ")} → número terminado em ${to.slice(-4)}`);
  if (process.env["SMOKE_CONFIRM"] !== "ENVIAR") {
    out("Nada foi enviado. Para enviar de verdade, defina SMOKE_CONFIRM=ENVIAR.");
    return;
  }
  for (const [name, run] of steps) {
    try {
      await run();
      out(`✓ ${name}`);
    } catch (e) {
      out(`✗ ${name}: ${e instanceof Error ? e.message : "erro"}`);
      process.exitCode = 1;
    }
  }
}

void main();
