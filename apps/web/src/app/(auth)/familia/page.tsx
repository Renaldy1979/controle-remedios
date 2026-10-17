import { redirect } from "next/navigation";
import { FamilyPickerScreen } from "@/components/screens/FamilyPickerScreen";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";

/** "Qual família?": só aparece para quem tem cadastro em mais de uma (lista só as DESTA pessoa). */
export default async function Page() {
  if (dataSourceKind() !== "appwrite") redirect("/");
  const [{ getAccess }, { membershipsOf }] = await Promise.all([import("@/server/context"), import("@/server/session")]);
  const access = await getAccess();
  if (access.status === "anon") redirect("/login");
  const memberships = access.status === "choose" ? access.memberships : await membershipsOf(access.ctx.userId);
  if (memberships.length <= 1) redirect("/");
  return <FamilyPickerScreen families={memberships.map((m) => ({ id: m.familyId, name: m.familyName }))} currentId={access.status === "ok" ? access.ctx.familyId : undefined} />;
}
