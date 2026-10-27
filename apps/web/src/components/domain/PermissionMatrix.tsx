"use client";
import type { PermissionRowVM } from "@/data";
import { Switch } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { isReadOnlyProfile } from "@medcuidar/shared";

interface Props {
  profiles: string[];
  rows: PermissionRowVM[];
  onChange: (rowId: string, profile: string, value: boolean) => void;
  readOnly?: boolean;
}

/** Grade funcionalidade × perfil. Administrador bloqueado ("Sempre"); linhas de ação travadas em "Somente leitura". */
export function PermissionMatrix({ profiles, rows, onChange, readOnly }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-bd bg-sf">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <caption className="sr-only">Permissões por perfil</caption>
        <thead>
          <tr>
            <th scope="col" className="bg-sf2 px-4 py-3 text-cap font-bold text-ink2">
              Funcionalidade
            </th>
            {profiles.map((p) => (
              <th key={p} scope="col" className="bg-sf2 px-3 py-3 text-center text-cap font-bold text-ink2">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-sf2">
              <th scope="row" className="border-t border-bd px-4 py-2 font-normal">
                {row.label}
              </th>
              {profiles.map((p, i) => (
                <td key={p} className="border-t border-bd px-3 py-1 text-center align-middle">
                  {p === "Administrador" ? (
                    <span className="inline-flex min-h-touch items-center gap-1 font-bold text-ink2">
                      <Icon name="lock" size={18} />
                      Sempre
                    </span>
                  ) : row.action && isReadOnlyProfile(p) ? (
                    <span aria-disabled="true" className="inline-flex min-h-touch items-center justify-center gap-1 text-cap font-bold text-ink2">
                      <Icon name="lock" size={18} />
                      ação: indisponível neste perfil
                    </span>
                  ) : (
                    <Switch small showState disabled={readOnly} checked={row.values[i] ?? false} onChange={(v) => onChange(row.id, p, v)} label={`${row.label} — ${p}`} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
