import type { Lot, Player, Team } from "@draft-app/engine";
import { useCountdown } from "../../lib/useCountdown";

type Props = {
  round: number;
  lotsInRound: Lot[];
  players: Player[];
  teams: Team[];
  currentLotId: string | null;
  paused: boolean;
  nextRoundDirection: "1 → 12" | "12 → 1" | null;
};

function LiveCard({ lot, player, paused }: { lot: Lot; player: Player | undefined; paused: boolean }) {
  const { label } = useCountdown(lot.endsAt, paused, { remainingMs: lot.remainingMs });
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-accent px-3.5 py-3 text-on-accent">
      <span className="text-[13px] font-extrabold tracking-[0.06em]">LOT {lot.orderInRound} · BIDDING NOW</span>
      <span className="text-[19px] font-extrabold">{player?.name ?? "—"}</span>
      <span className="text-[15px] font-semibold">{player?.position ?? ""}</span>
      <span className="text-[15px] font-semibold">{label} left</span>
    </div>
  );
}

/** Big board's round-lots grid: sold (dimmed), live (amber), next (amber outline), upcoming. */
export function RoundLotsGrid({ round, lotsInRound, players, teams, currentLotId, paused, nextRoundDirection }: Props) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const sorted = lotsInRound.slice().sort((a, b) => a.orderInRound - b.orderInRound);
  const currentIndex = sorted.findIndex((l) => l.id === currentLotId);

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-2.5">
      <div className="flex justify-between text-xl">
        <span className="font-bold uppercase tracking-[0.06em] text-muted">Round {round} lots</span>
      </div>
      <div className="grid grid-cols-6 gap-2.5">
        {sorted.map((lot, i) => {
          const player = playerById.get(lot.playerId);
          const nominator = teamById.get(lot.nominatedByTeamId);
          const isLive = lot.id === currentLotId;
          const isSold = lot.state === "awarded" && lot.winnerTeamId && lot.price !== null;
          const isNext = !isLive && currentIndex !== -1 && i === currentIndex + 1;

          if (isLive) return <LiveCard key={lot.id} lot={lot} player={player} paused={paused} />;

          if (isSold) {
            const winner = teamById.get(lot.winnerTeamId!);
            return (
              <div key={lot.id} className="flex flex-col gap-0.5 rounded-xl bg-[#141D17] px-3.5 py-3 text-muted">
                <span className="text-[13px] font-bold tracking-[0.06em]">LOT {lot.orderInRound} · SOLD</span>
                <span className="text-[19px] font-bold text-[#C9D3CA]">{player?.name ?? "—"}</span>
                <span className="text-[15px]">
                  {player?.position} · by Team {nominator?.draftNumber ?? "?"}
                </span>
                <span className="text-[15px]">
                  Team {winner?.draftNumber ?? "?"} · <strong className="text-text">${lot.price}</strong>
                </span>
              </div>
            );
          }

          if (isNext) {
            return (
              <div key={lot.id} className="flex flex-col gap-0.5 rounded-xl border-2 border-accent bg-surface px-3.5 py-3">
                <span className="text-[13px] font-bold tracking-[0.06em] text-accent">LOT {lot.orderInRound} · UP NEXT</span>
                <span className="text-[19px] font-bold">{player?.name ?? "—"}</span>
                <span className="text-[15px] text-muted">
                  {player?.position} · by Team {nominator?.draftNumber ?? "?"}
                </span>
              </div>
            );
          }

          return (
            <div key={lot.id} className="flex flex-col gap-0.5 rounded-xl bg-surface px-3.5 py-3">
              <span className="text-[13px] font-bold tracking-[0.06em] text-muted">LOT {lot.orderInRound}</span>
              <span className="text-[19px] font-bold">{player?.name ?? "—"}</span>
              <span className="text-[15px] text-muted">
                {player?.position} · by Team {nominator?.draftNumber ?? "?"}
              </span>
            </div>
          );
        })}
        {nextRoundDirection && (
          <div className="flex flex-col justify-center gap-0.5 rounded-xl border-2 border-dashed border-line px-3.5 py-3 text-muted">
            <span className="text-[15px] font-semibold">Next: round {round + 1}</span>
            <span className="text-[15px]">nominated {nextRoundDirection}</span>
          </div>
        )}
      </div>
    </div>
  );
}
