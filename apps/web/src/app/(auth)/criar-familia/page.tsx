import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { CreateFamilyForm } from "@/components/screens/auth/AuthForms";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar a família" };

export default async function Page() {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { getAccess } = await import("@/server/pg/access");
  const access = await getAccess();
  if (access.status === "anon" || access.status === "inactive") redirect("/login");
  if (access.status === "unverified") redirect("/verificar-email");
  if (access.status === "ok") redirect("/");
  const parts = access.account.name.trim().split(/\s+/);
  const suggestion = parts.length > 1 ? `Família ${parts[parts.length - 1]}` : "";
  return (
    <AuthFrame title="Primeira entrada" subtitle="Dê um nome para a sua família. Você será o(a) administrador(a).">
      <CreateFamilyForm defaultName={suggestion} />
    </AuthFrame>
  );
}
