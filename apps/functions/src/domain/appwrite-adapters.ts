import { ID, Query, type Tokens, type Users } from "node-appwrite";
import { findMembersByPhone } from "../login";
import type { AuthPort, DataFactory, GlobalData } from "../ports";
import { isConflict, s, sOpt } from "../rows";
import type { FileSigner } from "./binding";

const SESSION_TOKEN_LENGTH = 64;
const SESSION_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Sessão do painel por token customizado do Appwrite (`Users.createToken`). O usuário Appwrite é criado
 * na primeira entrada (pelo telefone, já validado pelo código de WhatsApp) e associado a todos os cadastros
 * de membro com esse telefone (`members.user_id`).
 */
export class AppwriteAuth implements AuthPort {
  constructor(
    private readonly users: Pick<Users, "create" | "list" | "createToken">,
    private readonly deps: { global: Pick<GlobalData, "listFamilies">; dataFor: DataFactory },
  ) {}

  async createSessionFor(phoneE164: string) {
    const matches = await findMembersByPhone(this.deps, phoneE164);
    const first = matches[0];
    if (!first) return null;

    let userId = matches.map((m) => sOpt(m.member, "user_id")).find((x): x is string => !!x);
    if (!userId) {
      try {
        userId = (await this.users.create({ userId: ID.unique(), phone: first.phone, name: s(first.member, "name") })).$id;
      } catch (e) {
        if (!isConflict(e)) throw e; // telefone já tem usuário (criado antes, sem vínculo no cadastro)
        const found = await this.users.list({ queries: [Query.equal("phone", [first.phone]), Query.limit(1)] });
        userId = found.users[0]?.$id;
        if (!userId) return null;
      }
    }
    for (const m of matches) {
      if (sOpt(m.member, "user_id") !== userId) await this.deps.dataFor(m.familyId).update("members", m.member.$id, { user_id: userId });
    }
    const token = await this.users.createToken({ userId, length: SESSION_TOKEN_LENGTH, expire: SESSION_TOKEN_TTL_SECONDS });
    return { token: token.secret, userId, expire: token.expire };
  }
}

/** URL de curta duração para a imagem da receita (token de arquivo do Appwrite com expiração). */
export class AppwriteFileSigner implements FileSigner {
  constructor(
    private readonly tokens: Pick<Tokens, "createFileToken">,
    private readonly cfg: { endpoint: string; projectId: string; bucketId: string; ttlSeconds?: number },
  ) {}

  async sign(storageFileId: string) {
    const expire = new Date(Date.now() + (this.cfg.ttlSeconds ?? 10 * 60) * 1000).toISOString();
    const token = await this.tokens.createFileToken({ bucketId: this.cfg.bucketId, fileId: storageFileId, expire });
    const base = this.cfg.endpoint.replace(/\/$/, "");
    return {
      url: `${base}/storage/buckets/${this.cfg.bucketId}/files/${storageFileId}/view?project=${this.cfg.projectId}&token=${token.secret}`,
    };
  }
}
