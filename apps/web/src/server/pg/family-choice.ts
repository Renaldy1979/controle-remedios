import type { VinculoDaConta } from "@medcuidar/pg";

/** Vínculo que dá para usar no portal: pessoa e família ativas, com acesso completo. */
export const vinculoUtilizavel = (v: VinculoDaConta) => v.ativo && v.estadoAcesso === "active";

/**
 * Qual vínculo vale nesta requisição (docs/15): com um só, é ele; com vários, a preferência do cookie SE for um deles;
 * senão null (a pessoa precisa escolher). A preferência nunca dá acesso a uma família fora da lista.
 */
export function escolherVinculo(utilizaveis: VinculoDaConta[], preferida: string | null | undefined): VinculoDaConta | null {
  if (utilizaveis.length === 1) return utilizaveis[0]!;
  return utilizaveis.find((v) => v.familiaId === preferida) ?? null;
}
