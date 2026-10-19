import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { SignUpForm } from "@/components/screens/auth/AuthForms";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta" };

export default async function Page() {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { getAccess } = await import("@/server/pg/access");
  if ((await getAccess()).status === "ok") redirect("/");
  return (
    <AuthFrame title="Criar conta" subtitle="Você será o(a) administrador(a) da família. Para convidar outras pessoas, use o convite dentro do portal.">
      <SignUpForm />
    </AuthFrame>
  );
}
