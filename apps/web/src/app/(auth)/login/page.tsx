import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { SignInForm } from "@/components/screens/auth/AuthForms";
import { LoginScreen } from "@/components/screens/LoginScreen";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function Page({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  // mock (só desenvolvimento): tela antiga simulada, sem login de verdade
  if (dataSourceKind() !== "postgres") return <LoginScreen />;
  const { getAccess } = await import("@/server/pg/access");
  const access = await getAccess();
  if (access.status === "ok") redirect("/");
  if (access.status === "unverified") redirect("/verificar-email");
  if (access.status === "nofamily") redirect("/criar-familia");
  const q = await searchParams;
  const notice =
    q.erro === "inativo" || access.status === "inactive"
      ? { kind: "error" as const, text: "Seu acesso foi desativado. Fale com quem administra a família." }
      : q.ok === "senha"
        ? { kind: "ok" as const, text: "Senha atualizada. Entre com a nova senha." }
        : undefined;
  return (
    <AuthFrame title="Entrar" subtitle="Use o e-mail e a senha da sua conta.">
      <SignInForm notice={notice} />
    </AuthFrame>
  );
}
