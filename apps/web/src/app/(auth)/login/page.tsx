import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/screens/LoginScreen";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function Page() {
  const real = dataSourceKind() === "appwrite";
  if (real) {
    // quem já tem sessão válida não precisa do código de novo
    const { getAccess } = await import("@/server/context");
    const access = await getAccess();
    if (access.status === "ok") redirect("/");
    if (access.status === "choose") redirect("/familia");
  }
  return <LoginScreen real={real} />;
}
