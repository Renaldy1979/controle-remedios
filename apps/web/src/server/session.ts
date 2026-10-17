import "server-only";
import { Account, Client, Query, Users } from "node-appwrite";
import { clients } from "./clients";
import { appwriteEnv } from "./env";

/**
 * Sessão do painel = SESSÃO do Appwrite Auth (docs/03): o login por código vira um token customizado
 * (`Users.createToken`, feito por @medcuidar/functions) e aqui o token é trocado por uma sessão
 * (`Account.createSession`). O segredo da sessão fica só em cookie httpOnly. Cada requisição valida a sessão
 * no Appwrite; revogar (`Users.deleteSessions`) vale na hora.
 */

const adminClient = () => {
  const e = appwriteEnv();
  return new Client().setEndpoint(e.endpoint).setProject(e.projectId).setKey(e.apiKey);
};

/** Cliente que age COMO a pessoa (sem chave de API): só enxerga o que a sessão dela permite. */
const sessionClient = (secret: string) => {
  const e = appwriteEnv();
  return new Client().setEndpoint(e.endpoint).setProject(e.projectId).setSession(secret);
};

export async function createSessionFromToken(userId: string, token: string): Promise<string> {
  const session = await new Account(adminClient()).createSession({ userId, secret: token });
  return session.secret;
}

/** Dono da sessão, ou null se ela não vale mais (expirada, revogada, inexistente). */
export async function userOfSession(secret: string | undefined): Promise<string | null> {
  if (!secret) return null;
  try {
    return (await new Account(sessionClient(secret)).get()).$id;
  } catch {
    return null;
  }
}

/** Sair: apaga a sessão atual no Appwrite. */
export async function deleteSession(secret: string | undefined): Promise<void> {
  if (!secret) return;
  try {
    await new Account(sessionClient(secret)).deleteSession({ sessionId: "current" });
  } catch {
    /* já estava inválida */
  }
}

/** Revogar: derruba todas as sessões da pessoa (remoção, troca de telefone). */
export async function revokeUserSessions(userId: string | undefined | null): Promise<void> {
  if (!userId) return;
  try {
    await new Users(adminClient()).deleteSessions({ userId });
  } catch (e) {
    if ((e as { code?: number }).code !== 404) throw e;
  }
}

export interface Membership {
  familyId: string;
  memberId: string;
  familyName: string;
}

/** Famílias DESTE usuário (um cadastro de membro por família), só os ativos. Índice `by_user` em `members`. */
export async function membershipsOf(userId: string): Promise<Membership[]> {
  const { databases, databaseId } = clients();
  const rows = await databases.listDocuments(databaseId, "members", [Query.equal("user_id", [userId]), Query.equal("active", [true]), Query.limit(50)]);
  const out: Membership[] = [];
  for (const m of rows.documents) {
    try {
      const fam = await databases.getDocument(databaseId, "families", String(m["family_id"]));
      if (fam["deleted_at"]) continue;
      out.push({ familyId: String(m["family_id"]), memberId: m.$id, familyName: String(fam["name"] ?? "Família") });
    } catch {
      /* família removida */
    }
  }
  return out.sort((a, b) => a.familyName.localeCompare(b.familyName, "pt-BR"));
}

/** Qual família usar: a escolhida (cookie) se for uma das da pessoa; senão a única; senão é preciso escolher. */
export function pickFamily(memberships: Membership[], chosenFamilyId: string | undefined): Membership | "choose" | null {
  if (memberships.length === 0) return null;
  const chosen = chosenFamilyId ? memberships.find((m) => m.familyId === chosenFamilyId) : undefined;
  if (chosen) return chosen;
  return memberships.length === 1 ? memberships[0]! : "choose";
}
