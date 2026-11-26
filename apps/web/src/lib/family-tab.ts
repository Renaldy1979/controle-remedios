/** Mesmo nome de FAMILY_TAB_COOKIE (server/cookies.ts). */
const TAB_COOKIE = "mc_familia_aba";

export const readFamilyMarker = (cookie: string = typeof document === "undefined" ? "" : document.cookie): string =>
  cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${TAB_COOKIE}=`))?.slice(TAB_COOKIE.length + 1) ?? "";

/**
 * A família ativa vale para o navegador inteiro. Se outra aba a trocou depois que esta abriu, o que esta mostra é de outra
 * família: a função devolvida diz isso. Compara com o valor do momento em que a aba abriu (assim nunca entra em laço).
 */
export function familyChangeDetector(read: () => string = readFamilyMarker): () => boolean {
  const opened = read();
  return () => read() !== opened;
}
