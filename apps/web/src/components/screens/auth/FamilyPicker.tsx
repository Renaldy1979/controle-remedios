import { chooseFamily, signOut } from "@/server/pg/auth-actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { FormNotice } from "./AuthFrame";

export interface FamilyOption {
  id: string;
  name: string;
  profileName: string;
  current: boolean;
}

/** Lista das famílias da conta (docs/15). Formulários simples: funcionam mesmo antes de a página hidratar. */
export function FamilyPicker({ families }: { families: FamilyOption[] }) {
  return (
    <div className="flex flex-col gap-4">
      {families.length === 0 ? <FormNotice kind="error">Seu acesso foi desativado. Fale com quem administra a família.</FormNotice> : null}
      {families.length ? (
        <ul aria-label="Suas famílias" className="flex flex-col gap-3">
          {families.map((f) => (
            <li key={f.id}>
              <form action={chooseFamily}>
                <input type="hidden" name="familia" value={f.id} />
                <button type="submit" className="flex min-h-16 w-full items-center gap-3 rounded-lg border-[1.5px] border-bd2 bg-sf p-4 text-left hover:bg-sf2">
                  <Icon name="groups" size={28} className="flex-none text-br" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-body-lg font-bold">{f.name}</span>
                    <span className="block text-cap text-ink2">Seu perfil: {f.profileName}</span>
                  </span>
                  {f.current ? (
                    <span className="flex flex-none items-center gap-1 text-cap font-bold text-ok">
                      <Icon name="check_circle" size={20} />
                      Atual
                    </span>
                  ) : (
                    <Icon name="chevron_right" size={24} className="flex-none text-ink2" />
                  )}
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <ButtonLink href="/criar-familia" variant="secondary" icon="add" full>
        {families.length ? "Criar outra família" : "Criar minha família"}
      </ButtonLink>
      <form action={signOut}>
        <Button type="submit" variant="ghost" icon="logout" full>
          Sair
        </Button>
      </form>
    </div>
  );
}
