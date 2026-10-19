import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { ConfirmEmailForm, VerifyPending } from "@/components/screens/auth/AuthForms";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar e-mail" };

export default async function Page({ searchParams }: { searchParams: Promise<{ userId?: string; secret?: string }> }) {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { userId, secret } = await searchParams;
  // veio do link do e-mail: confirma só no clique do botão
  if (userId && secret) {
    return (
      <AuthFrame title="Confirmar e-mail" subtitle="Toque no botão para confirmar que este e-mail é seu.">
        <ConfirmEmailForm userId={userId} secret={secret} />
      </AuthFrame>
    );
  }
  const { currentAccount } = await import("@/server/auth/session");
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (account.emailVerified) redirect("/criar-familia");
  return (
    <AuthFrame title="Confirme o seu e-mail" subtitle="Falta só isso para criar a sua família.">
      <VerifyPending email={account.email} />
    </AuthFrame>
  );
}
