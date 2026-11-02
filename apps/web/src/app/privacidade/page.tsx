import Link from "next/link";
import { PrivacyPolicy } from "@/components/screens/PrivacyPolicy";

export const metadata = { title: "Política de privacidade" };

/** Pública: qualquer pessoa lê sem entrar (as telas de entrada e as mensagens do WhatsApp apontam para cá). */
export default function Page() {
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh w-full max-w-[760px] flex-col gap-6 p-4 desk:py-12">
      <Link href="/login" className="inline-flex min-h-touch items-center font-bold text-br underline">
        MedCuidar
      </Link>
      <h1 className="font-display text-t1 font-extrabold">Política de privacidade</h1>
      <PrivacyPolicy />
    </main>
  );
}
