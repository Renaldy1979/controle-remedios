import type { Role } from "@/data/types";
import { cx } from "@/lib/format";
import { Icon } from "./Icon";

const initials = (name: string) => {
  const parts = name.replace(/^Seu /, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0]! : (parts[0]?.[1] ?? ""))).toUpperCase();
};

interface AvatarProps {
  name: string;
  role?: Role;
  size?: number;
  /** selo verde do WhatsApp no canto */
  whatsapp?: boolean;
  className?: string;
}

/** Círculo com iniciais. Cor por papel, nunca por status. O nome é lido pelo texto vizinho (aria-hidden). */
export function Avatar({ name, role = "other", size = 40, whatsapp, className }: AvatarProps) {
  return (
    <span className={cx("relative inline-flex flex-none", className)} style={{ width: size, height: size }}>
      <span
        aria-hidden="true"
        className="flex h-full w-full items-center justify-center rounded-full font-display font-extrabold"
        style={{ background: `var(--av-${role}-bg)`, color: `var(--av-${role}-fg)`, fontSize: Math.max(13, size * 0.38) }}
      >
        {initials(name)}
      </span>
      {whatsapp ? (
        <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-sf bg-[#1E9E6E] text-white">
          <Icon name="chat" size={10} />
        </span>
      ) : null}
    </span>
  );
}

export function AvatarGroup({ people, size = 32 }: { people: Array<{ name: string; role?: Role }>; size?: number }) {
  return (
    <span className="inline-flex" role="img" aria-label={people.map((p) => p.name).join(", ")}>
      {people.map((p, i) => (
        <span key={p.name} className={cx("rounded-full ring-2 ring-sf", i > 0 && "-ml-2.5")}>
          <Avatar name={p.name} role={p.role} size={size} />
        </span>
      ))}
    </span>
  );
}
