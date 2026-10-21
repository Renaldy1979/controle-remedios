// @vitest-environment node
/**
 * Bucket REAL do Appwrite, num bucket DEDICADO de teste (`zz-test-rx-…`) criado e apagado pelo próprio teste com a chave do .env
 * (precisa de `buckets.write`, `files.write`, `files.read`). Nunca toca o bucket `prescriptions` do dono. Só roda com
 * `RX_APPWRITE_TEST=1 pnpm --filter @medcuidar/web test rx-storage.appwrite` (usa a rede). Documentado em docs/09 e no roteiro do Lote 3.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Storage } from "node-appwrite";
import { UserError } from "./errors";
import { rxStorage } from "./rx-storage";

const on = process.env["RX_APPWRITE_TEST"] === "1";
// JPEG de 1x1 pixel
const JPEG_1x1 = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

describe.skipIf(!on)("armazenamento de receitas no Appwrite (bucket de teste dedicado)", () => {
  let storage: Storage;
  let bucketId = "";
  const saved = { ...process.env };

  beforeAll(async () => {
    try {
      process.loadEnvFile(new URL("../../../../../.env", import.meta.url));
    } catch {
      /* sem .env: vale o ambiente */
    }
    const c = new Client().setEndpoint(process.env["APPWRITE_ENDPOINT"]!).setProject(process.env["APPWRITE_PROJECT_ID"]!).setKey(process.env["APPWRITE_API_KEY"]!);
    storage = new Storage(c);
    bucketId = `zz-test-rx-${randomUUID().slice(0, 8)}`;
    await storage.createBucket({
      bucketId, name: "zz-test-rx", permissions: [], fileSecurity: true, enabled: true, maximumFileSize: 15 * 1024 * 1024,
      allowedFileExtensions: ["jpg", "jpeg", "png", "webp", "heic", "pdf"], encryption: true,
    });
    process.env["APPWRITE_PRESCRIPTIONS_BUCKET_ID"] = bucketId;
  });
  afterAll(async () => {
    if (bucketId) await storage.deleteBucket({ bucketId }).catch(() => undefined);
    process.env = saved;
  });

  it("guarda com nome neutro e sem permissão pública, lê inteiro e em miniatura, e apaga", async () => {
    const st = rxStorage();
    const id = await st.put(JPEG_1x1, "image/jpeg", 1);
    const meta = await storage.getFile({ bucketId, fileId: id });
    expect(meta.name).toBe("rx-p1.jpg");
    expect(meta.$permissions).toEqual([]); // sem leitura pública nem por papel: só a chave do portal lê

    const full = await st.read(id, "full");
    expect(full?.contentType).toBe("image/jpeg");
    expect(Buffer.from(full!.bytes).equals(JPEG_1x1)).toBe(true);
    const thumb = await st.read(id, "thumb");
    expect(thumb?.contentType).toBe("image/jpeg");

    // sem a chave do portal (sem sessão do Appwrite) o arquivo não abre
    const url = `${process.env["APPWRITE_ENDPOINT"]}/storage/buckets/${bucketId}/files/${id}/view?project=${process.env["APPWRITE_PROJECT_ID"]}`;
    expect([401, 403, 404]).toContain((await fetch(url)).status);

    await st.remove(id);
    expect(await st.read(id, "full")).toBeNull();
    await st.remove(id); // apagar de novo é inofensivo
  });

  it("recusa extensão fora da lista do bucket", async () => {
    await expect(rxStorage().put(Buffer.from("MZ"), "application/x-msdownload", 1)).rejects.toBeInstanceOf(UserError);
  });

  it("bucket inexistente ou sem configuração vira mensagem clara (não erro 500)", async () => {
    process.env["APPWRITE_PRESCRIPTIONS_BUCKET_ID"] = "zz-test-nao-existe";
    await expect(rxStorage().put(JPEG_1x1, "image/jpeg", 1)).rejects.toThrow(/ainda não foi configurado/);
    delete process.env["APPWRITE_PRESCRIPTIONS_BUCKET_ID"];
    await expect(rxStorage().put(JPEG_1x1, "image/jpeg", 1)).rejects.toThrow(/ainda não foi configurado/);
    process.env["APPWRITE_PRESCRIPTIONS_BUCKET_ID"] = bucketId;
  });
});
