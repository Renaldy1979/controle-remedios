import Link from "next/link";

/** Telas que param a pessoa numa família (privacidade, exclusão agendada) não podem prendê-la: as outras seguem acessíveis. */
export function SwitchFamilyLink() {
  return (
    <Link href="/escolher-familia" className="inline-flex min-h-touch items-center font-bold text-br underline-offset-2 hover:underline">
      Minhas famílias
    </Link>
  );
}
