import type { Player } from "@draft-app/engine";

type Props = {
  player: Player;
  nominatedByLabel: string;
  size: "phone" | "laptop" | "board";
};

const nameSize = { phone: "text-[32px]", laptop: "text-[64px]", board: "text-[84px]" };
const chipSize = { phone: "text-xs px-2 py-0.5", laptop: "text-sm px-2.5 py-[3px]", board: "text-lg px-3 py-1" };

export function PlayerCard({ player, nominatedByLabel, size }: Props) {
  const teamAndBye = [player.nflTeam, player.byeWeek ? `Bye week ${player.byeWeek}` : null].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-2 min-w-0 flex-grow">
      <span className={`self-start rounded-lg bg-chip text-accent font-bold tracking-[0.08em] ${chipSize[size]}`}>
        {size === "board" ? `${player.position}${player.nflTeam ? ` · ${player.nflTeam}` : ""}` : player.position}
      </span>
      <span className={`font-display font-extrabold uppercase leading-[0.95] ${nameSize[size]}`}>{player.name}</span>
      {size !== "board" && teamAndBye && <span className="text-sm text-muted">{teamAndBye}</span>}
      <span className={size === "board" ? "text-xl text-muted" : "text-sm text-muted"}>
        {nominatedByLabel}
        {size === "board" ? " · Sealed bids close when the clock hits zero" : ""}
      </span>
    </div>
  );
}
