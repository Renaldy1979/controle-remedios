/** Nomes dos cookies. Seguro para o middleware (Edge): só constantes. */
export const SESSION_COOKIE = "mc_session"; // segredo da SESSÃO do Appwrite (httpOnly)
/** Família ativa de quem participa de várias (docs/15). Só preferência: o servidor confere os vínculos a cada requisição. */
export const FAMILY_COOKIE = "mc_familia";
/** Cópia LEGÍVEL pela página do id acima: uma aba antiga percebe que a família mudou em outra aba e recarrega. Não dá acesso a nada. */
export const FAMILY_TAB_COOKIE = "mc_familia_aba";
export const FAMILY_TTL_SEC = 365 * 24 * 3600;
export const SESSION_TTL_SEC = 30 * 24 * 3600;
