import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsScreen } from "@/components/screens/SettingsScreen";
import { isSectionId } from "@/lib/settings-sections";

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === "usuarios") redirect("/configuracoes/pessoas"); // endereço antigo
  if (!isSectionId(section)) notFound();
  return (
    <Suspense>
      <SettingsScreen section={section} />
    </Suspense>
  );
}
