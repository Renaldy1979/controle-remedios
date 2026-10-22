import "server-only";
import { listarFamiliasAtivas } from "@medcuidar/pg";
import { registrarResultadoEnvio } from "./alertas";
import { marcarEnviada, pendentes, registrarFalhaEnvio, separarId } from "./fila";
import { logWa } from "./log";
import { ErroEnvio, type ProvedorWhatsapp } from "./provider/types";
import type { Ritmo } from "./ritmo";

/**
 * Saída dos lembretes e avisos agendados (substitui as agendas do N8N). Para cada família ativa: `pendentes()` GERA o que falta
 * (lembrete de dose, esquecida, estoque baixo, receita vencendo, reposição, resumo diário no horário da família; dedupe por chave),
 * descarta o obsoleto, dá o lease e devolve o que enviar AGORA, só para número VERIFICADO de quem não PAROU.
 * Garantias do envio:
 *  - marca como enviada ANTES de mandar: queda no meio nunca duplica;
 *  - recusa CLARA do provedor desfaz a marca e agenda nova tentativa com recuo (`registrarFalhaEnvio`), até virar erro definitivo visível;
 *  - falha ambígua (sem resposta) NÃO reenvia: melhor perder um lembrete do que mandar o remédio em dobro;
 *  - presença "digitando…" + pausa de 2 a 6 s antes de cada mensagem, teto por minuto/hora e escalonamento entre pessoas (ritmo.ts).
 */
export interface ResultadoSaida {
  enviadas: number;
  falhas: number;
  erroDefinitivo: number;
  ambiguas: number;
}

export async function enviarPendentes(
  provedor: ProvedorWhatsapp, ritmo: Ritmo, opts: { agora?: () => Date; limitePorFamilia?: number; parar?: () => boolean; somenteFamilia?: string } = {},
): Promise<ResultadoSaida> {
  const agoraFn = opts.agora ?? (() => new Date());
  const out: ResultadoSaida = { enviadas: 0, falhas: 0, erroDefinitivo: 0, ambiguas: 0 };
  for (const f of await listarFamiliasAtivas()) {
    if (opts.parar?.()) break;
    if (opts.somenteFamilia && f.familiaId !== opts.somenteFamilia) continue;
    let lista;
    try {
      lista = await pendentes(f.familiaId, { reivindicar: true, limite: opts.limitePorFamilia ?? 20, agora: agoraFn() });
    } catch (e) {
      logWa({ etapa: "saida_familia_falhou", erro: e instanceof Error ? e.name : "erro" });
      continue;
    }
    for (const m of lista) {
      if (opts.parar?.()) break;
      const ids = separarId(m.id, f.familiaId);
      if (!ids) continue;
      const marcou = await marcarEnviada(ids.familyId, ids.id, { agora: agoraFn() });
      if (!marcou.ok || marcou.jaEnviada) continue; // outra instância já cuidou
      try {
        await ritmo.escalonar(m.telefone);
        await ritmo.enviar(provedor, m.telefone, m.texto);
        out.enviadas++;
        if (provedor.id !== "fake") await registrarResultadoEnvio(true, agoraFn());
        logWa({ etapa: "saida", tipo: m.tipo, id: ids.id });
      } catch (e) {
        const motivo = e instanceof Error ? `${e.name}: ${e.message}` : "falha desconhecida";
        if (e instanceof ErroEnvio && e.recusaClara) {
          const destino = await registrarFalhaEnvio(ids.familyId, ids.id, motivo, agoraFn());
          out.falhas++;
          if (destino === "erro_definitivo") out.erroDefinitivo++;
          logWa({ etapa: "saida_falhou", tipo: m.tipo, id: ids.id, destino, erro: motivo });
        } else {
          out.ambiguas++;
          logWa({ etapa: "saida_ambigua", tipo: m.tipo, id: ids.id, erro: motivo });
        }
        if (provedor.id !== "fake") await registrarResultadoEnvio(false, agoraFn());
      }
    }
  }
  return out;
}
