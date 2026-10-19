import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { resolverLinkPrimeiroAcesso, sha256, withFamilia } from "@medcuidar/pg";
import * as s from "@medcuidar/pg/schema";
import { AuthFrame, FormNotice } from "@/components/screens/auth/AuthFrame";
import { AcceptInviteForm } from "@/components/screens/auth/AuthForms";
import { ButtonLink } from "@/components/ui/Button";
import { dataSourceKind } from "@/server/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aceitar convite" };

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string; userId?: string; secret?: string }> }) {
  if (dataSourceKind() !== "postgres") redirect("/login");
  const { t, userId, secret } = await searchParams;
  const link = t ? await resolverLinkPrimeiroAcesso(sha256(t)) : null;
  if (!t || !link || link.estadoAcesso !== "invited") {
    return (
      <AuthFrame title="Convite">
        <FormNotice kind="error">Este convite não vale mais. Peça um novo a quem administra a família.</FormNotice>
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
    <AuthFrame title="Você foi convidado(a)">
      <AcceptInviteForm token={t} userId={userId ?? ""} secret={secret ?? ""} name={info?.name ?? ""} familyName={info?.family ?? ""} profileName={info?.profile ?? ""} />
    </AuthFrame>
  );
}
