import { availablePlayerIds, eligibleNominationOrderForRound, lotsInRound, nominationOrderForRound, teamsByDraftNumber } from "@draft-app/engine";
import { useState } from "react";
import { useCountdown } from "../../lib/useCountdown";
import { emitIntent } from "../../lib/socket";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";

const POSITION_PILLS = ["All", "QB", "RB", "WR/TE", "K", "DEF"] as const;
type PositionPill = (typeof POSITION_PILLS)[number];

function matchesPill(position: string, pill: PositionPill): boolean {
  if (pill === "All") return true;
  if (pill === "WR/TE") return position === "WR" || position === "TE";
  return position === pill;
}

export function NominateScreen() {
  const { snapshot, socket } = useDraft();
  const [search, setSearch] = useState("");
  const [pill, setPill] = useState<PositionPill>("All");
  const [error, setError] = useState("");

  if (!snapshot) return null;
  const state = asEngineState(snapshot);
  const myTeamId = snapshot.myTeamId;
  const onTheClock = snapshot.nominationTurnTeamId !== null && snapshot.nominationTurnTeamId === myTeamId;
  const clockTeam = snapshot.teams.find((t) => t.id === snapshot.nominationTurnTeamId);
  const { label: clockLabel } = useCountdown(snapshot.nominationEndsAt, snapshot.paused);

  const round = snapshot.auctionRound;
  const roundLots = lotsInRound(state, round).slice().sort((a, b) => a.orderInRound - b.orderInRound);
  const totalNominators = eligibleNominationOrderForRound(state, round).length;
  const order = nominationOrderForRound(snapshot.settings, teamsByDraftNumber(snapshot.teams), round);
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  const directionLabel =
    order.length > 1 ? `${teamById.get(order[0]!)?.draftNumber} → ${teamById.get(order[order.length - 1]!)?.draftNumber}` : null;

  const available = availablePlayerIds(state)
    .map((id) => snapshot.players.find((p) => p.id === id)!)
    .filter((p) => matchesPill(p.position, pill))
    .filter((p) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.nflTeam ?? "").toLowerCase().includes(q);
    });

  const nominate = async (playerId: string) => {
    setError("");
    const ack = await emitIntent(socket, "nominate", { playerId });
    if (!ack.ok) setError(ack.message);
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-3.5 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>Round {round} · Nominations</span>
        <span>
          {roundLots.length} of {totalNominators} in
        </span>
      </div>

      {onTheClock ? (
        <div className="flex items-center justify-between rounded-panel bg-accent px-4 py-4 text-on-accent">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold uppercase tracking-[0.08em]">You&apos;re on the clock</span>
            <span className="text-[15px] font-medium">Put one player up for auction</span>
          </div>
          <span className="font-display text-4xl font-extrabold">{clockLabel}</span>
        </div>
      ) : (
        <div className="rounded-panel border border-line bg-surface px-4 py-4 text-[15px] text-muted">
          Team {clockTeam?.draftNumber ?? "?"} is nominating…
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">Search available players</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or NFL team"
          className="h-12 rounded-ctl border border-line bg-surface px-3.5 text-base text-text outline-none focus:border-accent"
        />
      </label>

      <div className="flex flex-wrap gap-1.5">
        {POSITION_PILLS.map((p) => {
          const active = pill === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => setPill(p)}
              className={`h-9 rounded-full px-3 text-sm font-semibold ${
                active ? "bg-text text-bg" : "border border-line bg-transparent text-text"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-[14px] border border-line">
        {available.length === 0 ? (
          <div className="px-4 py-4 text-sm text-muted">No players match.</div>
        ) : (
          available.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-3 bg-surface px-3.5 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
              <span className="w-11 text-xs font-bold text-accent">{p.position}</span>
              <div className="flex flex-grow flex-col min-w-0">
                <span className="text-base font-semibold">{p.name}</span>
                <span className="text-[13px] text-muted">
                  {p.nflTeam}
                  {p.byeWeek ? ` · Bye ${p.byeWeek}` : ""}
                </span>
              </div>
              <button
                type="button"
                disabled={!onTheClock}
                onClick={() => void nominate(p.id)}
                className="h-11 rounded-ctl bg-accent px-3.5 text-sm font-bold text-on-accent disabled:opacity-40"
              >
                Nominate
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 rounded-[14px] bg-surface px-3.5 py-3.5">
        <div className="text-[13px] font-bold uppercase tracking-[0.06em] text-muted">
          This round so far{directionLabel ? ` · ${directionLabel}` : ""}
        </div>
        {roundLots.length === 0 ? (
          <div className="text-sm text-muted">No nominations yet.</div>
        ) : (
          roundLots.map((l) => {
            const player = snapshot.players.find((p) => p.id === l.playerId);
            const nominator = teamById.get(l.nominatedByTeamId);
            return (
              <div key={l.id} className="flex justify-between text-[15px]">
                <span>
                  {l.orderInRound}. {player?.name} · {player?.position}
                </span>
                <span className="text-muted">Team {nominator?.draftNumber ?? "?"}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
