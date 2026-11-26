import { redirect } from "next/navigation";
import { listarVinculosDaConta } from "@medcuidar/pg";
import { AuthFrame } from "@/components/screens/auth/AuthFrame";
import { FamilyPicker } from "@/components/screens/auth/FamilyPicker";
import { dataSourceKind } from "@/server/env";
import { vinculoUtilizavel } from "@/server/pg/family-choice";
import { preferredFamily } from "@/server/pg/family-cookie";

export const dynamic = "force-dynamic";
export const metadata = { title: "Escolher família" };

export default async function Page() {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { getAccess } = await import("@/server/pg/access");
  const access = await getAccess();
  if (access.status === "anon") redirect("/login");
  if (access.status === "unverified") redirect("/verificar-email");
  if (access.status === "nofamily") redirect("/criar-familia");
  const { currentAccount } = await import("@/server/auth/session");
  const account = await currentAccount();
  if (!account) redirect("/login");
  const usable = (await listarVinculosDaConta(account.id)).filter(vinculoUtilizavel);
  const current = access.status === "ok" ? access.ctx.familyId : await preferredFamily();
  return (
    <AuthFrame
      title={usable.length ? "Escolher família" : "Acesso desativado"}
      subtitle={usable.length ? "Em qual família você quer entrar? Você pode trocar quando quiser." : undefined}
    >
      <FamilyPicker families={usable.map((v) => ({ id: v.familiaId, name: v.familiaNome, profileName: v.perfilNome, current: v.familiaId === current }))} />
    </AuthFrame>
  );
}
