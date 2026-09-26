import type { Pick as EnginePick, Player, Team } from "@draft-app/engine";
import { Fragment } from "react";

type Props = {
  totalRounds: number;
  teams: Team[];
  players: Player[];
  picks: EnginePick[];
  currentRound: number | null;
  currentTeamId: string | null;
};

/** Rounds × teams grid, on-the-clock cell highlighted — shared by the Snake pick screen's Board tab and the big board's snake-phase view. */
export function SnakeBoardGrid({ totalRounds, teams, players, picks, currentRound, currentTeamId }: Props) {
  const orderedTeams = teams.slice().sort((a, b) => a.draftNumber - b.draftNumber);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const pickByRoundTeam = new Map(
    picks.filter((p) => p.source === "snake" || p.source === "auto").map((p) => [`${p.round}:${p.teamId}`, p]),
  );

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${orderedTeams.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-r border-line bg-surface px-2 py-2 text-xs font-bold text-muted">Rd</div>
        {orderedTeams.map((t) => (
          <div key={t.id} className="border-b border-line bg-surface px-2 py-2 text-center text-xs font-bold text-muted">
            T{t.draftNumber}
          </div>
        ))}
        {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => (
          <Fragment key={round}>
            <div className="border-b border-r border-line px-2 py-2 text-xs font-semibold text-muted">{round}</div>
            {orderedTeams.map((t) => {
              const pick = pickByRoundTeam.get(`${round}:${t.id}`);
              const player = pick ? playerById.get(pick.playerId) : undefined;
              const onClock = round === currentRound && t.id === currentTeamId;
              return (
                <div
                  key={`${round}:${t.id}`}
                  className={`flex flex-col justify-center gap-0.5 border-b border-line px-2 py-2 text-[13px] ${onClock ? "bg-accent text-on-accent" : ""}`}
                >
                  {player ? (
                    <>
                      <span className="font-semibold leading-tight">{player.name}</span>
                      <span className={onClock ? "text-[11px]" : "text-[11px] text-muted"}>{player.position}</span>
                    </>
                  ) : onClock ? (
                    <span className="font-bold">On the clock</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
