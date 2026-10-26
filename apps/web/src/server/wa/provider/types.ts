/**
 * Provedor de WhatsApp atrás de interface (docs/06 seção 4). O portal não conhece o formato de nenhum provedor: ele recebe uma
 * `MensagemRecebida` normalizada e manda texto. Hoje Evolution Go; amanhã a API oficial da Meta (`meta.ts`, ainda esqueleto).
 */
export type TipoMensagem = "texto" | "imagem" | "audio" | "botao" | "outro" | "recusa";

export interface MensagemRecebida {
  /** id da mensagem no WhatsApp: dedupe da fila e chave de idempotência de tudo que a mensagem causa */
  msgId: string;
  /** remetente real, só dígitos (DDI+DDD+número; celular BR com o 9), como no cadastro */
  telefone: string;
  /** número para responder, como o provedor entregou */
  numeroResposta: string;
  tipo: TipoMensagem;
  /** texto digitado, legenda da foto ou texto do botão */
  texto: string;
  /** só botão/lista: ação reconhecida (tomei, lembrar, cuido, estoque, proximas, ajuda) */
  acao: string;
  /** mensagem pronta quando a mídia foi recusada (grande demais, não abriu) */
  aviso: string;
  mime: string;
  /** mídia em base64: só existe na fila enquanto a mensagem não é concluída */
  base64: string;
  segundos: number;
  /** referência para baixar a mídia depois quando o webhook não trouxe o conteúdo */
  midiaRef: Record<string, unknown> | null;
  /** segundos desde o envio (descarta atraso grande) */
  idadeSegundos: number | null;
}

export type ResultadoParse = { ignorar: string } | { mensagem: MensagemRecebida };

export interface EstadoInstancia {
  /** true/false; null = resposta em formato desconhecido */
  conectada: boolean | null;
}

export interface ProvedorWhatsapp {
  readonly id: string;
  /** Payload bruto do webhook → mensagem normalizada, ou o motivo de ignorar (própria, grupo, status, evento sem mensagem). */
  parseWebhook(corpo: unknown): ResultadoParse;
  /** Envia texto. Devolve o id da mensagem enviada (sintético se o provedor não devolver). */
  enviarTexto(numero: string, texto: string): Promise<{ messageId: string }>;
  /** "digitando…" (falha é ignorada por quem chama) */
  presenca(numero: string): Promise<void>;
  statusInstancia(): Promise<EstadoInstancia>;
  /**
   * "Este número está no WhatsApp?" Devolve o número (só dígitos) na forma que o WhatsApp usa. `null` = o provedor não soube responder
   * (rota ausente, erro, formato desconhecido): quem chama usa a forma cadastrada.
   */
  numeroNoWhatsapp(numero: string): Promise<{ existe: boolean; numero: string } | null>;
  /** Baixa a mídia quando o webhook não trouxe o base64. null se o provedor não conseguiu. */
  baixarMidia(ref: Record<string, unknown>): Promise<{ base64: string; mimetype: string } | null>;
}

/** Erro de envio com a informação que importa para o worker: se foi recusa clara (pode tentar de novo sem risco) ou ambíguo. */
export class ErroEnvio extends Error {
  constructor(message: string, readonly recusaClara: boolean, readonly numeroInexistente = false, readonly autenticacao = false) {
    super(message);
    this.name = "ErroEnvio";
  }
}
