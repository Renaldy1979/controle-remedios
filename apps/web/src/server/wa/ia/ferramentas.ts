import "server-only";
import { withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { localParts } from "@medcuidar/domain";
import { ForbiddenError } from "../../pg/errors";
import type { WaActor } from "../actor";
import { lerDosesDoDia, lerReceitas, lerReposicoes } from "../leitura";
import { normalizeText } from "../interpret";
import { proximasDosesHoje, visaoEstoque } from "../queries";
import { NOMES_FERRAMENTAS } from "./prompt";

/**
 * Executa as ferramentas SOMENTE DE LEITURA do agente, EM PROCESSO: os mesmos serviços de leitura da API `/api/v1`, dentro de
 * `withFamilia` (RLS), com as permissões do membro identificado (`actor`). O telefone/membro nunca é parâmetro: `actor` vem do remetente
 * real. As entradas do modelo são só filtros de texto; qualquer outro campo é descartado.
 */
export interface ResultadoFerramenta {
  conteudo: string;
  erro: boolean;
}

const MAX_CARACTERES = 8000;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const texto = (v: unknown, max = 60): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bate = (alvo: string, filtro: string): boolean => !filtro || normalizeText(alvo).includes(normalizeText(filtro));

const ok = (dados: unknown): ResultadoFerramenta => {
  let c = JSON.stringify(dados);
  if (c.length > MAX_CARACTERES) c = `${c.slice(0, MAX_CARACTERES)} …(cortado; peça um filtro mais específico)`;
  return { conteudo: c, erro: false };
};
const falha = (mensagem: string): ResultadoFerramenta => ({ conteudo: JSON.stringify({ erro: mensagem }), erro: true });

export async function executarFerramenta(actor: WaActor, nome: string, entrada: unknown, agora: Date): Promise<ResultadoFerramenta> {
  if (!NOMES_FERRAMENTAS.includes(nome)) return falha("Ferramenta desconhecida. Use só as ferramentas listadas.");
  const x = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const paciente = texto(x["paciente"]);
  const remedio = texto(x["remedio"]);
  try {
    switch (nome) {
      case "consultar_estoque": {
        const linhas = (await visaoEstoque(actor, agora)).filter((l) => bate(l.paciente, paciente) && bate(l.remedio, remedio));
        return ok({
          itens: linhas.slice(0, 30).map((l) => ({
            paciente: l.paciente, remedio: l.remedio, diasRestantes: l.dias, nivel: l.nivel, estimativa: l.estimativa,
          })),
          total: linhas.length,
        });
      }
      case "proximas_doses": {
        const lista = (await proximasDosesHoje(actor, agora, 20)).filter((d) => bate(d.paciente, paciente));
        return ok({ doses: lista.map((d) => ({ paciente: d.paciente, remedio: d.remedio, hora: d.hora, dose: d.dose, situacao: d.status })) });
      }
      case "doses_do_dia":
      case "status_da_dose": {
        const hoje = localParts(agora, actor.timezone).date;
        const pedida = texto(x["data"], 10);
        const data = nome === "doses_do_dia" && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : hoje;
        const dia = await lerDosesDoDia(actor, data, agora);
        const doses = dia.doses.filter((d) => bate(d.paciente, paciente) && bate(d.remedio, remedio));
        const quem = new Map<string, string>();
        const ids = [...new Set(doses.map((d) => d.confirmadaPor).filter((v): v is string => !!v))];
        if (ids.length) {
          const nomes = await withFamilia(actor.familyId, (tx) => tx.select({ id: s.members.id, n: s.members.name }).from(s.members));
          for (const n of nomes) if (ids.includes(n.id)) quem.set(n.id, n.n.trim().split(/\s+/)[0] ?? n.n);
        }
        return ok({
          data: dataBr(dia.data),
          doses: doses.slice(0, 40).map((d) => ({
            paciente: d.paciente, remedio: d.remedio, hora: d.hora, situacao: d.situacao,
            ...(d.confirmadaPor ? { marcadaPor: quem.get(d.confirmadaPor) ?? "alguém da família" } : {}),
          })),
        });
      }
      case "reposicoes_abertas": {
        const lista = (await lerReposicoes(actor)).filter((r) => bate(r.paciente, paciente) && bate(r.remedio, remedio));
        const nomes = await withFamilia(actor.familyId, (tx) => tx.select({ id: s.members.id, n: s.members.name }).from(s.members));
        const primeiro = (id: string | null) => (id ? (nomes.find((n) => n.id === id)?.n.trim().split(/\s+/)[0] ?? null) : null);
        const ETAPAS = ["pedir a receita", "receita recebida", "comprado", "estoque atualizado"];
        return ok({
          reposicoes: lista.map((r) => ({
            paciente: r.paciente, remedio: r.remedio, aberta: dataBr(r.abertaEm.slice(0, 10)),
            etapas: r.etapas.map((e) => ({ etapa: ETAPAS[e.etapa - 1] ?? `etapa ${e.etapa}`, concluida: e.concluida, naoSeAplica: e.naoSeAplica, responsavel: primeiro(e.responsavelId) })),
          })),
        });
      }
      case "receita_vigente": {
        // receitas só com acesso completo (active) e a permissão de ver receitas: quem só validou o WhatsApp recebe a negativa
        if (actor.access !== "active") return falha("Receitas só podem ser consultadas por quem já fez o primeiro acesso ao portal.");
        const lista = (await lerReceitas(actor, agora)).filter((r) => bate(r.paciente, paciente));
        const meds = new Map((await withFamilia(actor.familyId, (tx) => tx.select({ id: s.medications.id, n: s.medications.name }).from(s.medications))).map((m) => [m.id, m.n]));
        return ok({
          receitas: lista.slice(0, 20).map((r) => ({
            paciente: r.paciente, situacao: r.situacao, emitidaEm: dataBr(r.emitidaEm), ...(r.validaAte ? { validaAte: dataBr(r.validaAte) } : {}),
            remedios: r.remedioIds.map((id) => meds.get(id)).filter(Boolean),
          })),
        });
      }
      default:
        return falha("Ferramenta desconhecida.");
    }
  } catch (e) {
    if (e instanceof ForbiddenError) return falha("A pessoa não tem permissão para consultar isso.");
    return falha("Não consegui consultar agora.");
  }
}
