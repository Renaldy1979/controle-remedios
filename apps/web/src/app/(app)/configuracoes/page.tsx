import { Suspense } from "react";
import { SettingsScreen } from "@/components/screens/SettingsScreen";

export default function Page() {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  );
}
