import { Suspense } from "react";
import { SettingsScreen } from "@/components/screens/SettingsScreen";

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return (
    <Suspense>
      <SettingsScreen section={section} />
    </Suspense>
  );
}
