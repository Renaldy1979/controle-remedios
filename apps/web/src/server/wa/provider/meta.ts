import type { ProvedorWhatsapp } from "./types";

/** API oficial da Meta (WhatsApp Cloud API): esqueleto. Nada aqui está implementado; existe só para provar que a interface comporta a troca. */
export function criarMeta(): ProvedorWhatsapp {
  const naoImplementado = (): never => {
    throw new Error("Provedor Meta ainda não implementado (docs/06 seção 4).");
  };
  return {
    id: "meta",
    parseWebhook: naoImplementado,
    enviarTexto: naoImplementado,
    presenca: naoImplementado,
    statusInstancia: naoImplementado,
    numeroNoWhatsapp: naoImplementado,
    baixarMidia: naoImplementado,
  };
}
