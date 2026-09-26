import type { Pick as EnginePick, Player, Team } from "@draft-app/engine";
import { Fragment } from "react";

type Props = {
  totalRounds: number;
  teams: Team[];
  players: Player[];
  picks: EnginePick[];
  currentRound: number | null;
  currentTeamId: string | null;
  /** Make-up rounds to show after the snake rounds (rows "M1", "M2"…); 0 or omitted for none. */
  makeupRounds?: number;
  currentMakeupRound?: number | null;
};

/** Rounds × teams grid, on-the-clock cell highlighted — shared by the Snake pick screen's Board tab and the big board's snake/make-up views. */
export function SnakeBoardGrid({ totalRounds, teams, players, picks, currentRound, currentTeamId, makeupRounds = 0, currentMakeupRound = null }: Props) {
  const orderedTeams = teams.slice().sort((a, b) => a.draftNumber - b.draftNumber);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const pickByRoundTeam = new Map(
    picks.filter((p) => p.source === "snake" || p.source === "auto").map((p) => [`${p.round}:${p.teamId}`, p]),
  );
  const makeupPickByRoundTeam = new Map(picks.filter((p) => p.source === "makeup").map((p) => [`${p.round}:${p.teamId}`, p]));
  const rows = [
    ...Array.from({ length: totalRounds }, (_, i) => ({ key: `s${i + 1}`, label: String(i + 1), round: i + 1, byTeam: pickByRoundTeam, live: currentRound })),
    ...Array.from({ length: makeupRounds }, (_, i) => ({ key: `m${i + 1}`, label: `M${i + 1}`, round: i + 1, byTeam: makeupPickByRoundTeam, live: currentMakeupRound })),
  ];

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${orderedTeams.length}, minmax(0, 1fr))` }}>
        <div className="border-b border-r border-line bg-surface px-2 py-2 text-xs font-bold text-muted">Rd</div>
        {orderedTeams.map((t) => (
          <div key={t.id} className="border-b border-line bg-surface px-2 py-2 text-center text-xs font-bold text-muted">
            T{t.draftNumber}
          </div>
        ))}
        {rows.map(({ key, label, round, byTeam, live }) => (
          <Fragment key={key}>
            <div className="border-b border-r border-line px-2 py-2 text-xs font-semibold text-muted" title={label.startsWith("M") ? `Make-up round ${round}` : undefined}>
              {label}
            </div>
            {orderedTeams.map((t) => {
              const pick = byTeam.get(`${round}:${t.id}`);
              const player = pick ? playerById.get(pick.playerId) : undefined;
              const onClock = round === live && t.id === currentTeamId;
              return (
                <div
                  key={`${key}:${t.id}`}
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
