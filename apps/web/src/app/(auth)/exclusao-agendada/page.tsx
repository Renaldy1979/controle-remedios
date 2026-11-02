import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { CancelDeletionButton } from "@/components/screens/auth/DeletionPending";
import { dataSourceKind } from "@/server/env";
import { isAdmin } from "@/server/pg/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exclusão agendada" };

const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default async function Page() {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { getAccess } = await import("@/server/pg/access");
  const access = await getAccess();
  if (access.status === "anon" || access.status === "inactive") redirect("/login");
  if (access.status === "unverified") redirect("/verificar-email");
  if (access.status === "nofamily") redirect("/criar-familia");
  if (access.status !== "deletion") redirect("/");
  const admin = isAdmin({ member: access.member });
  return (
    <AuthFrame title="Exclusão agendada" subtitle={`Os dados da família ${access.familyName} serão apagados de vez em ${dataBr(access.dueAt)}.`}>
      <p>Até lá ninguém usa o sistema e os lembretes estão parados. Depois dessa data não há como recuperar.</p>
      {admin ? (
        <>
          <p>Mudou de ideia? Cancele e tudo volta ao normal.</p>
          <CancelDeletionButton />
        </>
      ) : (
        <p>Quem administra a família pode cancelar a exclusão antes dessa data.</p>
      )}
    </AuthFrame>
  );
}
