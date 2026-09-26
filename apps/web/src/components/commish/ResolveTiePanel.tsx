import type { Lot } from "@draft-app/engine";
import { useState } from "react";
import type { DraftSnapshot } from "../../lib/contracts";
import { useAdminIntent } from "./useAdminIntent";

/**
 * Only shown when a tie has hit the fallback and the league's fallback is
 * "commissioner decides" (SPEC: admin:resolveTie). Every amount shown here
 * was already revealed to everyone — tie re-bids are always revealed in full.
 * Choosing a team takes a second tap so a stray touch can't award a player.
 */
export function ResolveTiePanel({ snapshot, lot, disabled }: { snapshot: DraftSnapshot; lot: Lot; disabled: boolean }) {
  const { send, busy, error } = useAdminIntent();
  const [chosen, setChosen] = useState<string | null>(null);

  const player = snapshot.players.find((p) => p.id === lot.playerId);
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const revealedAmount = (teamId: string): number | null => {
    const bids = snapshot.bids.filter((b) => b.lotId === lot.id && b.teamId === teamId && !b.superseded && b.amount !== undefined);
    const latest = bids.sort((a, b) => b.tieRound - a.tieRound)[0];
    return latest?.amount ?? null;
  };

  return (
    <section aria-labelledby="resolve-tie" className="flex flex-col gap-2.5 rounded-[14px] border-2 border-warn-border bg-warn-bg p-3.5">
      <h2 id="resolve-tie" className="text-[13px] font-bold uppercase tracking-[0.06em] text-warn">
        Tie needs your call
      </h2>
      <div className="text-[15px]">
        Lot {lot.orderInRound} · {player?.name ?? "Unknown player"} · every tied team is all-in or the re-bid limit was hit. Pick the winner.
      </div>
      <div className="flex flex-col gap-1.5">
        {lot.tiedTeamIds.map((teamId) => {
          const team = teamById.get(teamId);
          const amount = revealedAmount(teamId);
          const isChosen = chosen === teamId;
          return (
            <button
              key={teamId}
              type="button"
              aria-pressed={isChosen}
              disabled={disabled || busy}
              onClick={() => setChosen(teamId)}
              className={`flex h-12 items-center justify-between rounded-ctl px-3.5 text-[15px] font-semibold disabled:opacity-40 ${
                isChosen ? "bg-accent text-on-accent" : "border border-line bg-surface"
              }`}
            >
              <span>
                Team {team?.draftNumber ?? "?"} · {team?.name ?? ""}
              </span>
              {amount !== null && <span className="font-display text-xl font-extrabold">${amount}</span>}
            </button>
          );
        })}
      </div>
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={disabled || busy || chosen === null}
        onClick={() => chosen && void send("admin:resolveTie", { lotId: lot.id, teamId: chosen })}
        className="h-12 rounded-ctl bg-warn text-[15px] font-bold text-on-accent disabled:opacity-40"
      >
        {chosen ? `Award to Team ${teamById.get(chosen)?.draftNumber ?? "?"}` : "Choose a team"}
      </button>
    </section>
  );
}
