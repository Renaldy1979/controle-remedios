/**
 * Falha de envio. `retryable` diz ao worker da outbox se vale tentar de novo
 * (provedor fora do ar, limite de taxa) ou se é erro definitivo (número inválido, 4xx).
 * A mensagem nunca carrega telefone nem texto da mensagem.
 */
export class ChannelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

export function errorForStatus(status: number, what: string): ChannelError {
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return new ChannelError(`${what}: HTTP ${status}`, retryable, status);
}
