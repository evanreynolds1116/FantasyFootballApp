import type { Lot, Player, Team } from "@draft-app/engine";

type Props = {
  round: number;
  lotsInRound: Lot[];
  players: Player[];
  teams: Team[];
  currentLotId: string | null;
};

/** Laptop bid screen's left column: this round's lots, sold ones dimmed with winner/price, live one highlighted, next one marked. */
export function RoundLotsList({ round, lotsInRound, players, teams, currentLotId }: Props) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const teamByIdMap = new Map(teams.map((t) => [t.id, t]));
  const sorted = lotsInRound.slice().sort((a, b) => a.orderInRound - b.orderInRound);
  const currentIndex = sorted.findIndex((l) => l.id === currentLotId);

  return (
    <div className="flex w-[300px] flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="label border-b border-line px-4 py-3.5">Round {round} lots</div>
      {sorted.map((lot, i) => {
        const player = playerById.get(lot.playerId);
        const isLive = lot.id === currentLotId;
        const isNext = !isLive && currentIndex !== -1 && i === currentIndex + 1;
        const isSold = lot.state === "awarded" && lot.winnerTeamId && lot.price !== null;

        return (
          <div
            key={lot.id}
            className={`flex justify-between gap-2 px-4 py-2.5 text-[15px] ${isLive ? "bg-chip font-bold text-accent" : isSold ? "text-muted" : ""}`}
          >
            <span>
              {lot.orderInRound} · {player?.name ?? "—"} · {player?.position ?? ""}
            </span>
            <span className={isSold ? "" : "text-muted"}>
              {isLive
                ? "Live"
                : isSold
                  ? `T${teamByIdMap.get(lot.winnerTeamId!)?.draftNumber ?? "?"} $${lot.price}`
                  : isNext
                    ? "Next"
                    : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
