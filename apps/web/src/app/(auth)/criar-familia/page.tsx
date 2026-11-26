import Link from "next/link";
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
  if (access.status === "anon") redirect("/login");
  if (access.status === "unverified") redirect("/verificar-email");
  const { currentAccount } = await import("@/server/auth/session");
  const account = await currentAccount();
  if (!account) redirect("/login");
  if (!account.emailVerified) redirect("/verificar-email");
  const first = access.status === "nofamily";
  const parts = account.name.trim().split(/\s+/);
  const suggestion = first && parts.length > 1 ? `Família ${parts[parts.length - 1]}` : "";
  return (
    <AuthFrame
      title={first ? "Primeira entrada" : "Nova família"}
      subtitle={first ? "Dê um nome para a sua família. Você será o(a) administrador(a)." : "Ela fica separada das outras: nada é copiado. Você será o(a) administrador(a)."}
    >
      <CreateFamilyForm defaultName={suggestion} />
      {first ? null : (
        <Link href="/escolher-familia" className="inline-flex min-h-touch items-center font-bold text-br underline-offset-2 hover:underline">
          Voltar sem criar
        </Link>
      )}
    </AuthFrame>
  );
}
