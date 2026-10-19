import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { ForgotPasswordForm } from "@/components/screens/auth/AuthForms";
import { dataSourceKind } from "@/server/env";

export const metadata = { title: "Esqueci minha senha" };
// A página lê DATA_SOURCE: sem isto o Next a gera no build (sem variáveis) e grava o redirecionamento para o login.
export const dynamic = "force-dynamic";

export default function Page() {
  if (dataSourceKind() !== "postgres") redirect("/login");
  return (
    <AuthFrame title="Esqueci minha senha" subtitle="Informe o e-mail da conta e enviaremos um link para criar uma nova senha.">
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
