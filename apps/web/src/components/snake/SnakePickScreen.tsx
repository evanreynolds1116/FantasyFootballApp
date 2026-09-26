import {
  availablePlayerIds,
  makeupOrderForRound,
  orderForRound,
  positionGroupCount,
  positionGroupFor,
  remainingMinimumsReachable,
  teamsByDraftNumber,
  wouldExceedPositionMax,
} from "@draft-app/engine";
import { useState } from "react";
import { useCountdown } from "../../lib/useCountdown";
import { emitIntent } from "../../lib/socket";
import { useDraft } from "../../store/DraftProvider";
import { asEngineState } from "../../store/selectors";
import { QueueStar } from "../queue/QueueStar";
import { useQueue } from "../queue/useQueue";
import { SnakeBoardGrid } from "./SnakeBoardGrid";

const POSITION_PILLS = ["All", "QB", "RB", "WR/TE", "K", "DEF"] as const;
type PositionPill = (typeof POSITION_PILLS)[number];

function matchesPill(position: string, pill: PositionPill): boolean {
  if (pill === "All") return true;
  if (pill === "WR/TE") return position === "WR" || position === "TE";
  return position === pill;
}

type Tab = "available" | "queue" | "board";

export function SnakePickScreen() {
  const { snapshot, socket } = useDraft();
  const [tab, setTab] = useState<Tab>("available");
  const [search, setSearch] = useState("");
  const [pill, setPill] = useState<PositionPill>("All");
  const [error, setError] = useState("");
  const q = useQueue();

  if (!snapshot) return null;
  const state = asEngineState(snapshot);
  const myTeamId = snapshot.myTeamId;
  const onTheClock = snapshot.snakePickTurnTeamId !== null && snapshot.snakePickTurnTeamId === myTeamId;
  const clockTeam = snapshot.teams.find((t) => t.id === snapshot.snakePickTurnTeamId);
  const { label: clockLabel } = useCountdown(snapshot.snakePickEndsAt, snapshot.paused);

  const isMakeup = snapshot.phase === "makeup";
  const totalRounds = snapshot.settings.rosterSize - snapshot.settings.auctionSpots;
  const pickNo = snapshot.picks.length + 1;

  // Preview only, ignores deferred pick-clock-expiry catch-up insertions —
  // those are a rare edge case (pickExpiryAction: "skip") and this is just a
  // "who's up next" hint, never anything a decision depends on.
  const baseIds = teamsByDraftNumber(snapshot.teams);
  const thisRoundOrder = isMakeup ? makeupOrderForRound(state) : orderForRound(baseIds, snapshot.snakeRound, 1);
  const clockIdx = thisRoundOrder.indexOf(snapshot.snakePickTurnTeamId ?? "");
  let upcoming = clockIdx >= 0 ? thisRoundOrder.slice(clockIdx + 1) : [];
  const nextMakeupOrder = isMakeup ? makeupOrderForRound(state, snapshot.makeupRound + 1) : [];
  if (isMakeup) {
    if (upcoming.length < 3) upcoming = [...upcoming, ...nextMakeupOrder];
  } else if (upcoming.length < 3 && snapshot.snakeRound < totalRounds) {
    upcoming = [...upcoming, ...orderForRound(baseIds, snapshot.snakeRound + 1, 1)];
  }
  // In make-up rounds only teams that went broke pick; everyone else is done.
  const inMakeup = isMakeup && myTeamId !== null && (thisRoundOrder.includes(myTeamId) || nextMakeupOrder.includes(myTeamId));
  const teamById = new Map(snapshot.teams.map((t) => [t.id, t]));
  // "you" rather than your own team number — at a turn-around (or in make-up rounds) you're often next again.
  const nextThree = upcoming.slice(0, 3).map((id) => (id === myTeamId ? "you" : `Team ${teamById.get(id)?.draftNumber ?? "?"}`));

  const groups = snapshot.settings.positionGroups ?? [];
  const needChips = myTeamId
    ? groups.map((group) => {
        const count = positionGroupCount(state, myTeamId, group);
        const remToMin = Math.max(0, group.min - count);
        const remToMax = group.max - count;
        const full = remToMax <= 0;
        const label = full ? "full" : remToMin > 0 && remToMin < remToMax ? `${remToMin}–${remToMax}` : `${remToMax}`;
        return { name: group.name, label, full };
      })
    : [];

  const available = availablePlayerIds(state)
    .map((id) => snapshot.players.find((p) => p.id === id)!)
    .filter((p) => matchesPill(p.position, pill))
    .filter((p) => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.nflTeam ?? "").toLowerCase().includes(q);
    });

  /** Whether a player can be drafted by you right now, and if not (on your turn), why — shared by the Available list and your queue. */
  const pickability = (p: { position: string }) => {
    const group = positionGroupFor(snapshot.settings.positionGroups, p.position);
    const maxedOut = myTeamId ? wouldExceedPositionMax(state, myTeamId, p.position) : false;
    const wouldBreakMinimums = myTeamId ? !remainingMinimumsReachable(state, myTeamId, p.position) : false;
    const disqualified = maxedOut || wouldBreakMinimums || !onTheClock;
    const reason = !onTheClock
      ? undefined
      : maxedOut
        ? `You already have ${group ? `${group.max} of ${group.max} ${group.name}` : "the max at this position"}`
        : wouldBreakMinimums
          ? "This pick would make a roster minimum unreachable"
          : undefined;
    return { disqualified, reason };
  };
  const playerById = new Map(snapshot.players.map((pl) => [pl.id, pl]));
  const queuedPlayers = q.available.map((id) => playerById.get(id)!).filter(Boolean);

  const draft = async (playerId: string) => {
    setError("");
    const ack = await emitIntent(socket, "pick:make", { playerId });
    if (!ack.ok) setError(ack.message);
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-grow flex-col gap-3.5 py-2">
      <div className="flex justify-between text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">
        <span>{isMakeup ? `Make-up · Round ${snapshot.makeupRound}` : `Snake · Round ${snapshot.snakeRound} of ${totalRounds}`}</span>
        <span>Pick {pickNo}</span>
      </div>

      {isMakeup && (
        <div className="rounded-[14px] border border-line bg-surface px-4 py-3 text-sm text-muted">
          {inMakeup
            ? "Make-up rounds: you went broke before filling your auction spots, so you fill them now with picks, one per round, in snake order among the teams still filling."
            : `Your roster is full. Make-up rounds are for teams that went broke before filling their auction spots${
                thisRoundOrder.length > 0 ? ` (${thisRoundOrder.map((id) => `Team ${teamById.get(id)?.draftNumber ?? "?"}`).join(", ")} this round)` : ""
              }.`}
        </div>
      )}

      {onTheClock ? (
        <div className="flex items-center justify-between rounded-panel bg-accent px-4 py-4 text-on-accent">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-bold uppercase tracking-[0.08em]">{isMakeup ? "Your make-up pick" : "You're on the clock"}</span>
            <span className="text-[15px] font-medium">
              {nextThree.length > 0 ? `Then ${nextThree.join(", ")}` : isMakeup ? "Last pick of the draft" : "Last pick of the snake"}
            </span>
          </div>
          <span className="font-display text-4xl font-extrabold">{clockLabel}</span>
        </div>
      ) : (
        <div className="rounded-panel border border-line bg-surface px-4 py-4 text-[15px] text-muted">
          Team {clockTeam?.draftNumber ?? "?"} is on the clock…
        </div>
      )}

      {myTeamId && needChips.length > 0 && (!isMakeup || inMakeup) && (
        <div className="flex flex-col gap-2 rounded-[14px] bg-surface px-3.5 py-3.5">
          <div className="label">You still need</div>
          <div className="flex flex-wrap gap-1.5">
            {needChips.map((c) => (
              <span
                key={c.name}
                className={c.full ? "rounded-lg border border-line px-2.5 py-1.5 text-sm font-semibold text-muted" : "rounded-lg bg-chip px-2.5 py-1.5 text-sm font-semibold"}
              >
                {c.name} · {c.label}
              </span>
            ))}
          </div>
          <div className="text-[13px] text-muted">Picks that would break these limits are greyed out.</div>
        </div>
      )}

      <div className="flex gap-1.5" role="tablist">
        {(["available", "queue", "board"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`h-10 flex-grow rounded-ctl text-sm font-bold ${tab === t ? "bg-text text-bg" : "border border-line bg-transparent text-text font-semibold"}`}
          >
            {t === "available" ? "Available" : t === "queue" ? `My queue (${q.available.length})` : "Board"}
          </button>
        ))}
      </div>

      {tab === "queue" && (
        <div className="flex flex-col gap-2">
          {queuedPlayers.length === 0 ? (
            <div className="rounded-panel border border-line bg-surface px-5 py-6 text-center text-muted">
              Your queue is empty. Tap ☆ next to any player to add him — your best choice first.
            </div>
          ) : (
            <ol className="flex flex-col overflow-hidden rounded-[14px] border border-line">
              {queuedPlayers.map((p, i) => {
                const { disqualified, reason } = pickability(p);
                return (
                  <li key={p.id} className={`flex items-center gap-2 bg-surface px-3 py-2.5 ${i > 0 ? "border-t border-line" : ""}`}>
                    <span className="w-6 text-center font-display text-lg font-extrabold text-muted">{i + 1}</span>
                    <div className="flex min-w-0 flex-grow flex-col">
                      <span className={`truncate text-base font-semibold ${disqualified && onTheClock ? "text-muted" : ""}`}>{p.name}</span>
                      <span className="truncate text-[13px] text-muted">
                        {p.position}
                        {p.nflTeam ? ` · ${p.nflTeam}` : ""}
                        {reason ? ` · ${reason}` : ""}
                      </span>
                    </div>
                    <button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => q.move(p.id, -1)} className="h-9 w-9 rounded-lg bg-surface-2 disabled:opacity-30">
                      ↑
                    </button>
                    <button type="button" aria-label={`Move ${p.name} down`} disabled={i === queuedPlayers.length - 1} onClick={() => q.move(p.id, 1)} className="h-9 w-9 rounded-lg bg-surface-2 disabled:opacity-30">
                      ↓
                    </button>
                    <button type="button" aria-label={`Remove ${p.name} from your queue`} onClick={() => q.remove(p.id)} className="h-9 w-9 rounded-lg border border-line text-muted">
                      ✕
                    </button>
                    {onTheClock && (
                      <button
                        type="button"
                        disabled={disqualified}
                        onClick={() => void draft(p.id)}
                        className="h-9 rounded-lg bg-accent px-3 text-sm font-bold text-on-accent disabled:border disabled:border-line disabled:bg-transparent disabled:text-muted"
                      >
                        Draft
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {error && (
            <div role="alert" className="text-sm font-semibold text-warn">
              {error}
            </div>
          )}
          <div className="text-[13px] text-muted">
            Your queue is private. Players who get taken drop off it automatically.
            {snapshot.settings.pickExpiryAction === "autoPick" && " If your clock runs out, you get the first player in it who fits your roster."}
          </div>
        </div>
      )}

      {tab === "board" && (
        <SnakeBoardGrid
          totalRounds={totalRounds}
          teams={snapshot.teams}
          players={snapshot.players}
          picks={snapshot.picks}
          currentRound={isMakeup ? null : snapshot.snakeRound}
          currentTeamId={snapshot.snakePickTurnTeamId}
          makeupRounds={isMakeup ? snapshot.makeupRound : 0}
          currentMakeupRound={isMakeup ? snapshot.makeupRound : null}
        />
      )}

      {tab === "available" && (
        <>
          <label className="flex items-center gap-2 rounded-ctl border border-line bg-surface px-3.5">
            <input
              type="search"
              aria-label="Search available players"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search available players"
              className="h-[46px] min-w-0 flex-grow border-0 bg-transparent text-base text-text outline-none"
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
                  className={`h-9 rounded-full px-3 text-sm font-semibold ${active ? "bg-text text-bg" : "border border-line bg-transparent text-text"}`}
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
              available.map((p, i) => {
                const { disqualified, reason } = pickability(p);

                return (
                  <div key={p.id} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? "border-t border-line" : ""} ${disqualified && onTheClock ? "bg-[#131B16]" : "bg-surface"}`}>
                    <span className={`w-11 text-xs font-bold ${disqualified && onTheClock ? "text-[#7F8E82]" : "text-accent"}`}>{p.position}</span>
                    <div className="flex flex-grow flex-col min-w-0">
                      <span className={`text-base font-semibold ${disqualified && onTheClock ? "text-muted" : ""}`}>{p.name}</span>
                      <span className="text-[13px] text-muted">{reason ? `${p.nflTeam} · ${reason}` : `${p.nflTeam ?? ""}${p.byeWeek ? ` · Bye ${p.byeWeek}` : ""}`}</span>
                    </div>
                    {q.canQueue && <QueueStar queued={q.isQueued(p.id)} onToggle={() => q.toggle(p.id)} name={p.name} />}
                    <button
                      type="button"
                      disabled={disqualified}
                      onClick={() => void draft(p.id)}
                      className="h-11 rounded-ctl bg-accent px-4 text-sm font-bold text-on-accent disabled:border disabled:border-line disabled:bg-transparent disabled:text-muted"
                    >
                      Draft
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-auto text-[13px] text-muted">
            {snapshot.settings.pickExpiryAction === "skip"
              ? "If the clock runs out, your turn moves to the end of this round and you'll pick then instead."
              : "If the clock runs out, you get the first player in your queue who fits your roster, or else the best available player who does."}
          </div>
        </>
      )}
    </div>
  );
}
