import { redirect } from "next/navigation";
import { AuthFrame, FormNotice } from "@/components/screens/auth/AuthFrame";
import { ResetPasswordForm } from "@/components/screens/auth/AuthForms";
import { ButtonLink } from "@/components/ui/Button";
import { dataSourceKind } from "@/server/env";

export const metadata = { title: "Nova senha" };
// A página lê DATA_SOURCE: sem isto o Next a gera no build (sem variáveis) e grava o redirecionamento para o login.
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ userId?: string; secret?: string }> }) {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { userId, secret } = await searchParams;
  if (!userId || !secret) {
    return (
      <AuthFrame title="Nova senha">
        <FormNotice kind="error">Link inválido ou vencido.</FormNotice>
        <ButtonLink href="/esqueci-senha" variant="secondary" icon="forward_to_inbox">
          Pedir um novo link
        </ButtonLink>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Criar uma nova senha" subtitle="Escolha uma senha que você consiga lembrar.">
      <ResetPasswordForm userId={userId} secret={secret} />
    </AuthFrame>
  );
}
