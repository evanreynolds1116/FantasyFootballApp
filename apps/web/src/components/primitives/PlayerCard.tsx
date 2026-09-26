import type { Player } from "@draft-app/engine";
import { PlayerPhoto } from "./PlayerPhoto";

type Props = {
  player: Player;
  nominatedByLabel: string;
  size: "phone" | "laptop" | "board";
};

const nameSize = { phone: "text-[32px]", laptop: "text-[64px]", board: "text-[84px]" };
const chipSize = { phone: "text-xs px-2 py-0.5", laptop: "text-sm px-2.5 py-[3px]", board: "text-lg px-3 py-1" };
const photoSize = { phone: 56, laptop: 120, board: 160 };

export function PlayerCard({ player, nominatedByLabel, size }: Props) {
  // Position, NFL team and bye week together above the name, the same on every screen (like the big board).
  const chip = [player.position, player.nflTeam, player.byeWeek ? `Bye ${player.byeWeek}` : null].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-grow items-center gap-3 md:gap-4">
      <PlayerPhoto player={player} size={photoSize[size]} />
      <div className="flex min-w-0 flex-grow flex-col gap-2">
        <span className={`self-start rounded-lg bg-chip text-accent font-bold tracking-[0.08em] ${chipSize[size]}`}>
          {chip}
        </span>
        <span className={`font-display font-extrabold uppercase leading-[0.95] ${nameSize[size]}`}>{player.name}</span>
        <span className={size === "board" ? "text-xl text-muted" : "text-sm text-muted"}>
          {nominatedByLabel}
          {size === "board" ? " · Sealed bids close when the clock hits zero" : ""}
        </span>
      </div>
    </div>
  );
}
