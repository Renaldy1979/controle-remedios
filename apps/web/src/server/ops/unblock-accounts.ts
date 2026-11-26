import "server-only";
import { listarContasDeVinculosInativos } from "@medcuidar/pg";
import { setUserEnabled } from "../auth/appwrite";
import { gravarRuntime, lerRuntime } from "../wa/runtime";

/**
 * Ajuste único do Lote 5E (docs/15, seção 5): antes, desativar uma pessoa bloqueava o LOGIN no Appwrite. Libera essas contas
 * (o acesso à família continua negado pelo banco). Idempotente; só marca como feito se todas deram certo. Log só com contagens.
 */
export async function unblockAccountsOnce(enable: (id: string) => Promise<void> = (id) => setUserEnabled(id, true)): Promise<{ done: boolean; released: number; failed: number }> {
  if (await lerRuntime<{ em: string }>("contas_5e")) return { done: true, released: 0, failed: 0 };
  let released = 0;
  let failed = 0;
  for (const id of await listarContasDeVinculosInativos()) {
    try {
      await enable(id);
      released++;
    } catch {
      failed++;
    }
  }
  if (failed === 0) await gravarRuntime("contas_5e", { em: new Date().toISOString(), liberadas: released });
  console.warn(`[contas] ajuste do Lote 5E: liberadas=${released} falhas=${failed}`);
  return { done: failed === 0, released, failed };
}
