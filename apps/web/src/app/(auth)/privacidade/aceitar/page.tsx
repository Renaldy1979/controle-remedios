import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { PrivacyAcceptButton } from "@/components/screens/auth/PrivacyAccept";
import { PrivacyPolicy } from "@/components/screens/PrivacyPolicy";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacidade" };

export default async function Page() {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { getAccess } = await import("@/server/pg/access");
  const access = await getAccess();
  if (access.status === "anon" || access.status === "inactive") redirect("/login");
  if (access.status === "unverified") redirect("/verificar-email");
  if (access.status === "nofamily") redirect("/criar-familia");
  if (access.status === "deletion") redirect("/exclusao-agendada");
  if (access.status === "ok") redirect("/");
  return (
    <AuthFrame title="Sua privacidade" subtitle="O MedCuidar guarda dados de saúde. Leia como cuidamos deles e aceite para continuar.">
      <PrivacyPolicy />
      <PrivacyAcceptButton />
    </AuthFrame>
  );
}
