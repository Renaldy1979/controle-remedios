import { LoginScreen } from "@/components/screens/LoginScreen";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";

export default function Page() {
  return <LoginScreen real={dataSourceKind() === "appwrite"} />;
}
