import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ErroEnvio, type MensagemRecebida, type ProvedorWhatsapp } from "./types";

/**
 * Provedor `fake`: nenhuma mensagem real é enviada. Guarda o que "enviaria" em memória (e, com `WHATSAPP_FAKE_FILE`, o registro de
 * cada envio, SEM o texto, num arquivo JSON por linha) para testes e para o simulador. Recusado com APP_ENV=production (ver `criarProvedor`).
 */
export interface EnvioFake {
  numero: string;
  texto: string;
  em: number;
}

export interface ProvedorFake extends ProvedorWhatsapp {
  readonly enviados: EnvioFake[];
  readonly presencas: string[];
  /** falhas programadas para os próximos envios (teste de retentativa) */
  falharProximos(n: number, recusaClara?: boolean): void;
  conectada: boolean | null;
  /** números (só dígitos) que o fake trata como "não existe no WhatsApp": o envio falha com `numeroInexistente` */
  readonly inexistentes: Set<string>;
  /** respostas da consulta "está no WhatsApp?": número consultado → número devolvido; sem entrada e `consultaIndisponivel` = null */
  readonly consulta: Map<string, string>;
  consultaIndisponivel: boolean;
  /** consultas feitas (para os testes) */
  readonly consultas: string[];
  limpar(): void;
}

export function criarFake(opts: { arquivo?: string } = {}): ProvedorFake {
  const enviados: EnvioFake[] = [];
  const presencas: string[] = [];
  let falhas = 0, clara = true, seq = 0;
  const p: ProvedorFake = {
    id: "fake",
    enviados, presencas, conectada: true, inexistentes: new Set<string>(), consulta: new Map<string, string>(), consultaIndisponivel: true, consultas: [],
    falharProximos(n, recusaClara = true) { falhas = n; clara = recusaClara; },
    limpar() { enviados.length = 0; presencas.length = 0; falhas = 0; },
    parseWebhook(corpo) {
      const c = (corpo ?? {}) as Partial<MensagemRecebida>;
      if (!c.msgId || !c.telefone) return { ignorar: "sem_id" };
      return {
        mensagem: {
          msgId: c.msgId, telefone: c.telefone, numeroResposta: c.numeroResposta ?? c.telefone, tipo: c.tipo ?? "texto", texto: c.texto ?? "",
          acao: c.acao ?? "", aviso: c.aviso ?? "", mime: c.mime ?? "", base64: c.base64 ?? "", segundos: c.segundos ?? 0, midiaRef: null, idadeSegundos: 0,
        },
      };
    },
    async enviarTexto(numero, texto) {
      if (p.inexistentes.has(numero.replace(/\D/g, ""))) throw new ErroEnvio("número inexistente", true, true);
      if (falhas > 0) {
        falhas--;
        throw new ErroEnvio("falha programada", clara);
      }
      enviados.push({ numero, texto, em: Date.now() });
      if (opts.arquivo) {
        mkdirSync(path.dirname(opts.arquivo), { recursive: true });
        appendFileSync(opts.arquivo, `${JSON.stringify({ em: Date.now() })}\n`);
      }
      return { messageId: `fake-${++seq}` };
    },
    async presenca(numero) { presencas.push(numero); },
    async statusInstancia() { return { conectada: p.conectada }; },
    async numeroNoWhatsapp(numero) {
      p.consultas.push(numero);
      if (p.consultaIndisponivel && !p.consulta.has(numero)) return null;
      const r = p.consulta.get(numero);
      return r ? { existe: true, numero: r } : { existe: false, numero };
    },
    async baixarMidia() { return null; },
  };
  return p;
}
