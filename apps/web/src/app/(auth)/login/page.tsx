import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { SignInForm } from "@/components/screens/auth/AuthForms";
import { LoginScreen } from "@/components/screens/LoginScreen";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function Page({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  // mock (só desenvolvimento): tela antiga simulada, sem login de verdade
  if (dataSourceKind() !== "postgres") return <LoginScreen />;
  const { getAccess } = await import("@/server/pg/access");
  const access = await getAccess();
  if (access.status === "ok" || access.status === "privacy" || access.status === "deletion") redirect("/");
  if (access.status === "unverified") redirect("/verificar-email");
  if (access.status === "nofamily") redirect("/criar-familia");
  if (access.status === "choose" || access.status === "inactive") redirect("/escolher-familia");
  const q = await searchParams;
  const notice = q.ok === "senha" ? { kind: "ok" as const, text: "Senha atualizada. Entre com a nova senha." } : undefined;
  return (
    <AuthFrame title="Entrar" subtitle="Use o e-mail e a senha da sua conta.">
      <SignInForm notice={notice} />
    </AuthFrame>
  );
}
