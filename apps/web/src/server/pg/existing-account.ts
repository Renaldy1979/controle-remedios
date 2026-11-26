import "server-only";
import { accountOfSession, appwriteCode, signInWithPassword, type AuthAccount } from "../auth/appwrite";
import { currentAccount, writeSession } from "../auth/session";
import { bloqueadoPor, enderecoDoCliente, registrarFalha, registrarSucesso } from "../auth/throttle";

export type ProvenAccount = { ok: true; account: AuthAccount } | { ok: false; error: string };

/**
 * A conta que vai receber um novo vínculo: a da sessão atual ou, sem sessão, a que entrar com e-mail e senha agora
 * (com o mesmo bloqueio de tentativas do login). Exige e-mail confirmado.
 */
export async function proveAccount(email: string, password: string): Promise<ProvenAccount> {
  let account = await currentAccount();
  if (!account) {
    const address = email.trim().toLowerCase();
    if (!address || !password) return { ok: false, error: "Informe e-mail e senha." };
    const ip = await enderecoDoCliente();
    const wait = bloqueadoPor(address, ip);
    if (wait > 0) return { ok: false, error: `Muitas tentativas erradas. Aguarde ${wait} min e tente de novo.` };
    try {
      const session = await signInWithPassword(address, password);
      account = await accountOfSession(session.secret);
      registrarSucesso(address);
      await writeSession(session.secret, session.expire);
    } catch (e) {
      registrarFalha(address, ip);
      return { ok: false, error: appwriteCode(e) === 429 ? "Muitas tentativas. Aguarde um pouco e tente de novo." : "E-mail ou senha incorretos." };
    }
  }
  if (!account) return { ok: false, error: "Não foi possível entrar agora. Tente de novo." };
  if (!account.emailVerified) return { ok: false, error: "Confirme o e-mail da sua conta (veja a caixa de entrada) e abra este link de novo." };
  return { ok: true, account };
}
