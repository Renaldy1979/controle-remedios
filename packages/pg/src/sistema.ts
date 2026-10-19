import { sql } from "drizzle-orm";
import { getDb, type Db } from "./client";

/**
 * Funções SECURITY DEFINER: o que a API precisa saber ANTES de ter uma família (telefone, login, chave).
 * Depois disso, tudo roda em `withFamilia(familiaId, ...)`. Veja docs/07-banco-postgres.md.
 */

export type EstadoAcesso = "invited" | "whatsapp_verified" | "active";

export type MembroPorTelefone = {
  membroId: string; familiaId: string; ativo: boolean; familiaAtiva: boolean; estadoAcesso: EstadoAcesso;
};

/** Telefone VERIFICADO (só dígitos, DDI+DDD+número) → membro e família. Fora do formato ou desconhecido → null. */
export async function resolverMembroPorTelefone(telefone: string, db: Db = getDb()): Promise<MembroPorTelefone | null> {
  const r = await db.execute<{ member_id: string; family_id: string; active: boolean; family_active: boolean; access_state: EstadoAcesso }>(
    sql`select * from resolve_member_by_phone(${telefone})`,
  );
  const m = r[0];
  return m ? { membroId: m.member_id, familiaId: m.family_id, ativo: m.active, familiaAtiva: m.family_active, estadoAcesso: m.access_state } : null;
}

export type MembroPorLogin = { membroId: string; familiaId: string; ativo: boolean; estadoAcesso: EstadoAcesso };

/** Usuário do Appwrite Auth (login por e-mail/senha) → membro e família. */
export async function resolverMembroPorAppwriteUser(appwriteUserId: string, db: Db = getDb()): Promise<MembroPorLogin | null> {
  const r = await db.execute<{ member_id: string; family_id: string; active: boolean; access_state: EstadoAcesso }>(
    sql`select * from resolve_member_by_appwrite_user(${appwriteUserId})`,
  );
  const m = r[0];
  return m ? { membroId: m.member_id, familiaId: m.family_id, ativo: m.active, estadoAcesso: m.access_state } : null;
}

export type ApiKeyResolvida =
  | { tipo: "familia"; keyId: string; familiaId: string; escopos: string[] }
  | { tipo: "plataforma"; keyId: string; familiaId: null; escopos: string[] };

/** sha256 (hex) da chave Bearer → família (cdf_) ou plataforma (cpl_). Revogada/inexistente → null. */
export async function resolverApiKeyPorHash(chaveHash: string, db: Db = getDb()): Promise<ApiKeyResolvida | null> {
  const r = await db.execute<{ kind: "family" | "platform"; key_id: string; family_id: string | null; scopes: string[] }>(
    sql`select * from resolve_api_key(${chaveHash})`,
  );
  const k = r[0];
  if (!k) return null;
  return k.kind === "family"
    ? { tipo: "familia", keyId: k.key_id, familiaId: k.family_id as string, escopos: k.scopes }
    : { tipo: "plataforma", keyId: k.key_id, familiaId: null, escopos: k.scopes };
}

export type ResultadoVerificacao = "verificado" | "invalido" | "bloqueado" | "em_uso";

/**
 * Remetente real (só dígitos) + sha256 do código → promove o número pendente a verificado.
 * A família volta só para auditoria; a API nunca a expõe ao remetente.
 */
export async function verificarTelefonePendente(
  telefone: string, codigoHash: string, db: Db = getDb(),
): Promise<{ resultado: ResultadoVerificacao; membroId: string | null; familiaId: string | null }> {
  const r = await db.execute<{ result: ResultadoVerificacao; member_id: string | null; family_id: string | null }>(
    sql`select * from verify_pending_phone(${telefone}, ${codigoHash})`,
  );
  const v = r[0];
  return v
    ? { resultado: v.result, membroId: v.member_id, familiaId: v.family_id }
    : { resultado: "invalido", membroId: null, familiaId: null };
}

export type ResultadoConvite = {
  resultado: ResultadoVerificacao; membroId: string | null; familiaId: string | null; conviteId: string | null; perfilId: string | null;
};

/**
 * Convite por WhatsApp: o REMETENTE real (só dígitos) e o hash do código (hashConviteCodigo(remetente, código)).
 * Só vale se o remetente é o número esperado; consome o convite (uso único) e deixa o membro `whatsapp_verified`.
 * Quem não é o número esperado recebe "invalido" sem gastar tentativa do convite alheio.
 * Depois de `verificado`, o app cria o link de primeiro acesso (first_access_links) em withFamilia.
 */
export async function consumirConviteWhatsapp(telefone: string, codigoHash: string, db: Db = getDb()): Promise<ResultadoConvite> {
  const r = await db.execute<{
    result: ResultadoVerificacao; member_id: string | null; family_id: string | null; invite_id: string | null; profile_id: string | null;
  }>(sql`select * from consume_whatsapp_invite(${telefone}, ${codigoHash})`);
  const v = r[0];
  return v
    ? { resultado: v.result, membroId: v.member_id, familiaId: v.family_id, conviteId: v.invite_id, perfilId: v.profile_id }
    : { resultado: "invalido", membroId: null, familiaId: null, conviteId: null, perfilId: null };
}

export type LinkPrimeiroAcesso = {
  linkId: string; membroId: string; familiaId: string; email: string | null; estadoAcesso: EstadoAcesso; expiraEm: Date;
};

/** sha256 do token → link válido (não usado, não revogado, não vencido), sem consumir. Para renderizar a tela. */
export async function resolverLinkPrimeiroAcesso(tokenHash: string, db: Db = getDb()): Promise<LinkPrimeiroAcesso | null> {
  const r = await db.execute<{
    link_id: string; member_id: string; family_id: string; email: string | null; access_state: EstadoAcesso; expires_at: Date;
  }>(sql`select * from resolve_first_access_link(${tokenHash})`);
  const l = r[0];
  return l
    ? { linkId: l.link_id, membroId: l.member_id, familiaId: l.family_id, email: l.email, estadoAcesso: l.access_state, expiraEm: new Date(l.expires_at) }
    : null;
}

/** Consome o link (uso único, atômico). Chame ao concluir o primeiro acesso; depois ative o membro em withFamilia. */
export async function consumirLinkPrimeiroAcesso(
  tokenHash: string, db: Db = getDb(),
): Promise<{ linkId: string; membroId: string; familiaId: string } | null> {
  const r = await db.execute<{ link_id: string; member_id: string; family_id: string }>(
    sql`select * from consume_first_access_link(${tokenHash})`,
  );
  const l = r[0];
  return l ? { linkId: l.link_id, membroId: l.member_id, familiaId: l.family_id } : null;
}
