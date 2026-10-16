"use client";
import { useActions, useSnapshot } from "@/data";
import { PermissionMatrix } from "@/components/domain/PermissionMatrix";
import { Icon } from "@/components/ui/Icon";

export function ProfilesPanel() {
  const snap = useSnapshot();
  const actions = useActions();
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-start gap-2 text-ink2">
        <Icon name="info" size={22} className="mt-0.5 text-br" />
        Cada perfil liga ou desliga uma funcionalidade. O Administrador sempre pode tudo.
      </p>
      <PermissionMatrix profiles={snap.profiles} rows={snap.permissionRows} onChange={actions.setPermission} />
    </div>
  );
}
