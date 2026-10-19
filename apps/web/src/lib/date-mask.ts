/**
 * Máscara de data brasileira enquanto a pessoa digita: só dígitos, com as barras colocadas sozinhas.
 * "1003" -> "10/03", "10031942" -> "10/03/1942". Apagar funciona porque tudo é recalculado dos dígitos.
 */
export function maskDate(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
