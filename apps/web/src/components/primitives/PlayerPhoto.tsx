import { useState } from "react";

type Props = {
  player: { name: string; position: string; photoUrl?: string };
  /** Width and height in px. */
  size: number;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

/**
 * The player's headshot (a team logo for a defense), to the left of the
 * name. Falls back to their initials when the pool has no photo or it
 * fails to load — decorative either way, since the name is right beside it.
 */
export function PlayerPhoto({ player, size }: Props) {
  const [failed, setFailed] = useState(false);
  const logo = player.position === "DEF";
  const style = { width: size, height: size };

  if (!player.photoUrl || failed) {
    return (
      <span
        aria-hidden="true"
        style={{ ...style, fontSize: Math.round(size * 0.36) }}
        className="flex flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display font-extrabold text-muted"
      >
        {initials(player.name)}
      </span>
    );
  }
  return (
    <img
      src={player.photoUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={style}
      className={`flex-shrink-0 rounded-full border border-line bg-surface-2 ${logo ? "object-contain p-[8%]" : "object-cover object-top"}`}
    />
  );
}
