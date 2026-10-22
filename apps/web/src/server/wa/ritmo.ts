import { ErroEnvio, type ProvedorWhatsapp } from "./provider/types";

/**
 * Ritmo de envio (anti-bloqueio, docs/11): presença "digitando…" + pausa aleatória de 2 a 6 s antes de TODA mensagem, teto de mensagens
 * por minuto e por hora (janela deslizante) e escalonamento extra entre destinatários diferentes. Relógio, sono e sorteio são
 * injetáveis para os testes não esperarem de verdade.
 */
export interface Relogio {
  agora(): number;
  dormir(ms: number): Promise<void>;
  aleatorio(): number;
}

export const relogioReal: Relogio = {
  agora: () => Date.now(),
  dormir: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  aleatorio: () => Math.random(),
};

const numeroEnv = (nome: string, padrao: number): number => {
  const v = Number(process.env[nome]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : padrao;
};

export interface ConfigRitmo {
  maxPorMinuto: number;
  maxPorHora: number;
  relogio: Relogio;
}

export const configRitmoDoAmbiente = (): Pick<ConfigRitmo, "maxPorMinuto" | "maxPorHora"> => ({
  maxPorMinuto: numeroEnv("WHATSAPP_MAX_PER_MINUTE", 12),
  maxPorHora: numeroEnv("WHATSAPP_MAX_PER_HOUR", 150),
});

export interface Ritmo {
  /** Espera até caber mais um envio nos tetos e o registra. */
  esperarVaga(): Promise<void>;
  /** "digitando…", pausa de 2 a 6 s e envia. Falha da presença é ignorada; falha do envio lança. */
  enviar(provedor: ProvedorWhatsapp, numero: string, texto: string): Promise<void>;
  /** Pausa extra (1 a 3 s) quando o destinatário muda em relação ao envio anterior. */
  escalonar(numero: string): Promise<void>;
}

/** Pausa de 2 a 6 s em passos de 1 s. */
export const pausaDigitandoMs = (aleatorio: () => number): number => 2000 + Math.min(4, Math.floor(aleatorio() * 5)) * 1000;

export function criarRitmo(cfg: Partial<ConfigRitmo> = {}): Ritmo {
  const relogio = cfg.relogio ?? relogioReal;
  const env = configRitmoDoAmbiente();
  const maxMin = cfg.maxPorMinuto ?? env.maxPorMinuto;
  const maxHora = cfg.maxPorHora ?? env.maxPorHora;
  const envios: number[] = [];
  let ultimo = "";

  const esperarVaga = async () => {
    for (;;) {
      const t = relogio.agora();
      while (envios.length && t - envios[0]! >= 3_600_000) envios.shift();
      const naUltimaMin = envios.filter((e) => t - e < 60_000);
      if (naUltimaMin.length < maxMin && envios.length < maxHora) {
        envios.push(t);
        return;
      }
      const espera = naUltimaMin.length >= maxMin ? 60_000 - (t - naUltimaMin[0]!) : 3_600_000 - (t - envios[0]!);
      await relogio.dormir(Math.max(250, espera));
    }
  };

  return {
    esperarVaga,
    async escalonar(numero) {
      if (ultimo && ultimo !== numero) await relogio.dormir(1000 + Math.min(2, Math.floor(relogio.aleatorio() * 3)) * 1000);
      ultimo = numero;
    },
    async enviar(provedor, numero, texto) {
      await esperarVaga();
      try {
        await provedor.presenca(numero);
      } catch {
        /* presença nunca impede a resposta */
      }
      await relogio.dormir(pausaDigitandoMs(relogio.aleatorio));
      await provedor.enviarTexto(numero, texto);
    },
  };
}

/** Falha do envio em que NADA saiu (o provedor recusou com clareza): só nesse caso é seguro tentar de novo. */
export const recusaClara = (e: unknown): boolean => e instanceof ErroEnvio && e.recusaClara;
