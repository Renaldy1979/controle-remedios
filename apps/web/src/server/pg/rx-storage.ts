import "server-only";
import { Client, ID, Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { appwriteAuthEnv, memoryStorageForTests, prescriptionsBucketId } from "../env";
import { UserError } from "./errors";

/** Limites das páginas de uma receita (docs/08, Lote 3). */
export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const RX_MIME_EXT: Readonly<Record<string, string>> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" };

export type RxVariant = "thumb" | "full";

/** Onde as páginas ficam guardadas. Só o servidor fala com ele; a pessoa recebe os bytes por `/api/rx-file` (sessão + permissão + URL assinada). */
export interface RxStorage {
  /** Guarda uma página e devolve o id no bucket. O nome do arquivo é neutro (`rx-p1.jpg`): nada de dado pessoal no storage. */
  put(bytes: Buffer, mime: string, page: number): Promise<string>;
  remove(storageFileId: string): Promise<void>;
  /** `thumb` = miniatura reduzida (só imagem); `full` = arquivo inteiro. */
  read(storageFileId: string, variant: RxVariant): Promise<{ bytes: ArrayBuffer; contentType: string } | null>;
}

const NOT_CONFIGURED =
  "O armazenamento das receitas ainda não foi configurado. Peça a quem cuida da instalação para concluir o passo “Lote 3” do guia (docs/09) e tente de novo.";

/** Falhas do Appwrite viram uma mensagem clara (bucket ou escopo faltando, serviço fora do ar), nunca um erro 500. */
export function storageError(e: unknown): UserError {
  const code = (e as { code?: number } | null)?.code;
  if (e instanceof UserError) return e;
  if (code === 401 || code === 403 || code === 404) {
    // Só o código HTTP e o "tipo" do Appwrite (ex.: general_unauthorized_scope = chave sem files.write,
    // storage_bucket_not_found = ID do bucket errado, user_unauthorized = permissão). Sem mensagem, endereço ou chave.
    const type = String((e as { type?: unknown } | null)?.type ?? "desconhecido").replace(/[^a-z0-9_]/gi, "").slice(0, 60);
    console.error(`[rx-storage] armazenamento não configurado (codigo=${code} tipo=${type})`);
    return new UserError(NOT_CONFIGURED);
  }
  console.error("[rx-storage] falhou", (e as Error)?.name, code ?? "");
  return new UserError("Não foi possível falar com o armazenamento das receitas agora. Tente de novo em instantes.");
}

/** Bucket do Appwrite (privado, com file security): as páginas são criadas SEM permissão de leitura pública; só a chave do portal lê. */
class AppwriteRxStorage implements RxStorage {
  private storage(): { storage: Storage; bucketId: string } {
    const bucketId = prescriptionsBucketId();
    if (!bucketId) throw new UserError(NOT_CONFIGURED);
    const e = appwriteAuthEnv();
    return { storage: new Storage(new Client().setEndpoint(e.endpoint).setProject(e.projectId).setKey(e.apiKey)), bucketId };
  }

  async put(bytes: Buffer, mime: string, page: number): Promise<string> {
    const ext = RX_MIME_EXT[mime];
    if (!ext) throw new UserError("Use fotos (JPG, PNG, WEBP, HEIC) ou PDF.");
    try {
      const { storage, bucketId } = this.storage();
      const created = await storage.createFile({ bucketId, fileId: ID.unique(), file: InputFile.fromBuffer(bytes, `rx-p${page}.${ext}`), permissions: [] });
      return created.$id;
    } catch (e) {
      throw storageError(e);
    }
  }

  async remove(storageFileId: string): Promise<void> {
    try {
      const { storage, bucketId } = this.storage();
      await storage.deleteFile({ bucketId, fileId: storageFileId });
    } catch (e) {
      if ((e as { code?: number } | null)?.code !== 404) throw storageError(e);
    }
  }

  async read(storageFileId: string, variant: RxVariant): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
    try {
      const { storage, bucketId } = this.storage();
      if (variant === "thumb") return { bytes: await storage.getFilePreview({ bucketId, fileId: storageFileId, width: 360, quality: 60 }), contentType: "image/jpeg" };
      const file = await storage.getFile({ bucketId, fileId: storageFileId });
      return { bytes: await storage.getFileView({ bucketId, fileId: storageFileId }), contentType: file.mimeType };
    } catch (e) {
      if ((e as { code?: number } | null)?.code === 404) return null;
      throw storageError(e);
    }
  }
}

/** Só no e2e (E2E_TEST_MODE=1 + RX_STORAGE=memory): guarda em memória; some quando o servidor reinicia. */
class MemoryRxStorage implements RxStorage {
  private files = new Map<string, { bytes: Buffer; mime: string }>();
  async put(bytes: Buffer, mime: string, page: number): Promise<string> {
    void page;
    const id = `mem-${ID.unique()}`;
    this.files.set(id, { bytes, mime });
    return id;
  }
  async remove(storageFileId: string): Promise<void> {
    this.files.delete(storageFileId);
  }
  async read(storageFileId: string, variant: RxVariant) {
    const f = this.files.get(storageFileId);
    if (!f) return null;
    if (variant === "thumb" && !f.mime.startsWith("image/")) return null;
    const bytes = f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer;
    return { bytes, contentType: f.mime };
  }
  count(): number {
    return this.files.size;
  }
}

const g = globalThis as unknown as { __rxMemoryStorage?: MemoryRxStorage };

/** O armazenamento em uso: o bucket do Appwrite (padrão) ou, só em teste, a memória do servidor. */
export function rxStorage(): RxStorage {
  if (memoryStorageForTests()) return (g.__rxMemoryStorage ??= new MemoryRxStorage());
  return new AppwriteRxStorage();
}

/** Há armazenamento configurado? (a tela de receitas usa isto para avisar antes de tentar enviar; o health NÃO depende disto.) */
export function storageConfigured(): boolean {
  return memoryStorageForTests() || !!prescriptionsBucketId();
}
