/* eslint-disable no-console -- CLI interativa: a saída no terminal é o produto. */
import { createInterface } from "node:readline/promises";
import { PERSONAS, runReminderScenario, WhatsAppSimulator, type PersonaKey } from "./simulator";

const HELP = `
Simulador local de WhatsApp (nada sai para a rede; domínio FALSO).
  <texto>             escreve como a pessoa atual
  /quem ana|rosa|joao|estranho
  /botao N            toca no botão N da última mensagem recebida pela pessoa atual
  /audio <texto>      manda um áudio cuja transcrição é <texto>
  /tick               roda o agendador (1 minuto) e a fila
  /avancar MIN        avança o relógio
  /estoque            mostra o saldo do livro-razão (Zypred)
  /roteiro            roda lembrete → Tomei → desconto → alerta
  /ajuda | /sair
`;

async function main() {
  if (process.argv.includes("--scenario")) {
    const { steps, sim } = await runReminderScenario();
    console.log(steps.join("\n"));
    console.log(`\nSaldo de Zypred no livro-razão: ${sim.world.stockBalance()} (movimentos: ${sim.world.movements().length})`);
    return;
  }
  const sim = new WhatsAppSimulator({ now: new Date("2026-10-15T10:45:00.000Z") });
  let who: PersonaKey = "rosa";
  console.log(HELP);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const flush = () => {
    for (const m of sim.drain()) console.log(sim.format(m));
  };
  for (;;) {
    const line = (await rl.question(`\n[${PERSONAS[who].name}] ${sim.world.clock.current.toISOString()} > `)).trim();
    if (!line) continue;
    try {
      if (line === "/sair") break;
      else if (line === "/ajuda") console.log(HELP);
      else if (line.startsWith("/quem ")) {
        const k = line.slice(6).trim() as PersonaKey;
        if (!(k in PERSONAS)) console.log("Pessoa desconhecida.");
        else who = k;
      } else if (line.startsWith("/botao ")) await sim.tap(who, Number(line.slice(7)));
      else if (line.startsWith("/audio ")) await sim.audio(who, line.slice(7));
      else if (line === "/tick") console.log(await sim.tick());
      else if (line.startsWith("/avancar ")) sim.advance(Number(line.slice(9)));
      else if (line === "/estoque") console.log(`Zypred: ${sim.world.stockBalance()} (movimentos: ${sim.world.movements().length})`);
      else if (line === "/roteiro") console.log((await runReminderScenario(sim)).steps.join("\n"));
      else await sim.say(who, line);
    } catch (e) {
      console.log(`Erro: ${e instanceof Error ? e.message : String(e)}`);
    }
    flush();
  }
  rl.close();
}

void main();
