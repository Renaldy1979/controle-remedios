/** Nomes dos cookies. Seguro para o middleware (Edge): só constantes. */
export const SESSION_COOKIE = "mc_session"; // segredo da SESSÃO do Appwrite (httpOnly)
export const FAMILY_COOKIE = "mc_family"; // família escolhida quando o telefone está em mais de uma
export const SESSION_TTL_SEC = 30 * 24 * 3600;
