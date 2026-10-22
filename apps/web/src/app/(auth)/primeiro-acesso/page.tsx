import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { resolverLinkPrimeiroAcesso, sha256, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { AuthFrame, FormNotice } from "@/components/screens/auth/AuthFrame";
import { FirstAccessForm } from "@/components/screens/auth/AuthForms";
import { ButtonLink } from "@/components/ui/Button";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Primeiro acesso" };

/** Link de uso único enviado ao WhatsApp de quem aceitou o convite pelo número (docs/06 seção 2). Rota pública. */
export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { t } = await searchParams;
  const link = t ? await resolverLinkPrimeiroAcesso(sha256(t)) : null;
  if (!t || !link || link.estadoAcesso !== "whatsapp_verified") {
    return (
      <AuthFrame title="Primeiro acesso">
        <FormNotice kind="error">Este link não vale mais (ele vale 24 horas e só pode ser usado uma vez). Responda “link de acesso” no WhatsApp para receber um novo.</FormNotice>
        <ButtonLink href="/login" variant="secondary" icon="login">
          Ir para o login
        </ButtonLink>
      </AuthFrame>
    );
  }
  const info = await withFamilia(link.familiaId, async (tx) => {
    const [r] = await tx
      .select({ name: s.members.name, profile: s.profiles.name, family: s.families.name })
      .from(s.members)
      .innerJoin(s.profiles, eq(s.profiles.id, s.members.profileId))
      .innerJoin(s.families, eq(s.families.id, s.members.familyId))
      .where(eq(s.members.id, link.membroId));
    return r;
  });
  return (
    <AuthFrame title="Primeiro acesso" subtitle="Defina seu e-mail e sua senha para usar o portal.">
      <FirstAccessForm token={t} name={info?.name ?? ""} familyName={info?.family ?? ""} profileName={info?.profile ?? ""} />
    </AuthFrame>
  );
}
