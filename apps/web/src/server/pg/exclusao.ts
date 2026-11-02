import "server-only";
import { dadosExternosDaFamilia, excluirFamiliaDefinitivo, listarFamiliasParaExcluir } from "@medcuidar/pg";
import { DELETION_GRACE_DAYS } from "@/lib/privacy";
import { deleteUser } from "../auth/appwrite";
import { rxStorage } from "./rx-storage";

export interface ResultadoExclusao {
  excluidas: number;
  falhas: number;
}

export interface DepsExclusao {
  /** troca o armazenamento das receitas e a remoção de contas (testes) */
  removerArquivo?: (id: string) => Promise<void>;
  removerConta?: (id: string) => Promise<void>;
  dias?: number;
}

/**
 * Exclusão definitiva das famílias cujo pedido venceu (LGPD, docs/13). Ordem: 1) lista o que existe FORA do Postgres, 2) apaga as
 * fotos no bucket e as contas de login no Appwrite (as duas operações aceitam repetir: "não existe" não é erro), 3) só então apaga
 * as linhas do Postgres. Se algo falhar no meio, o banco continua sendo o índice do que falta: a próxima rodada tenta de novo.
 * Não há dado pessoal em log: só contagens.
 */
export async function excluirFamiliasVencidas(deps: DepsExclusao = {}): Promise<ResultadoExclusao> {
  const removerArquivo = deps.removerArquivo ?? ((id: string) => rxStorage().remove(id));
  const removerConta = deps.removerConta ?? deleteUser;
  let excluidas = 0;
  let falhas = 0;
  for (const familiaId of await listarFamiliasParaExcluir(deps.dias ?? DELETION_GRACE_DAYS)) {
    try {
      const externos = await dadosExternosDaFamilia(familiaId);
      for (const arquivo of externos.arquivos) await removerArquivo(arquivo);
      for (const conta of externos.usuariosAppwrite) await removerConta(conta);
      await excluirFamiliaDefinitivo(familiaId);
      excluidas++;
      console.warn(`[exclusao] família excluída (arquivos=${externos.arquivos.length} contas=${externos.usuariosAppwrite.length})`);
    } catch (e) {
      falhas++;
      console.error("[exclusao] falhou; tenta de novo na próxima rodada", (e as Error).name, (e as { code?: unknown }).code ?? "");
    }
  }
  return { excluidas, falhas };
}
