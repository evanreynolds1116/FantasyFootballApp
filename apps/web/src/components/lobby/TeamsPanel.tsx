import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type LeagueDetail, type LobbyTeam } from "../../lib/api";

function TeamRow({
  team,
  index,
  total,
  canRename,
  isCommissioner,
  busy,
  onRename,
  onMove,
  onRelease,
}: {
  team: LobbyTeam;
  index: number;
  total: number;
  canRename: boolean;
  isCommissioner: boolean;
  busy: boolean;
  onRename: (name: string) => Promise<boolean>;
  onMove: (delta: -1 | 1) => void;
  onRelease: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [confirmRelease, setConfirmRelease] = useState(false);

  return (
    <li className={`flex flex-col gap-2 rounded-ctl border px-3 py-2.5 ${team.isMine ? "border-accent bg-chip" : "border-line bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className="w-7 flex-shrink-0 text-center font-display text-xl font-extrabold">{team.draftNumber}</span>
        {editing ? (
          <form
            className="flex min-w-0 flex-grow gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim() && (await onRename(name.trim()))) setEditing(false);
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              aria-label={`Name for team ${team.draftNumber}`}
              autoFocus
              className="h-10 min-w-0 flex-grow rounded-ctl border border-line bg-surface-sunk px-2.5 text-text outline-none focus:border-accent"
            />
            <button type="submit" disabled={busy} className="h-10 rounded-ctl bg-accent px-3 text-sm font-bold text-on-accent">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-10 rounded-ctl border border-line px-3 text-sm font-semibold">
              Cancel
            </button>
          </form>
        ) : (
          <span className="flex min-w-0 flex-grow flex-col">
            <span className="truncate font-semibold">
              {team.name}
              {team.isMine && <span className="ml-2 text-xs font-bold uppercase tracking-[0.06em] text-accent">You</span>}
            </span>
            {team.claimed ? (
              <span className="text-sm text-muted">{team.managerName}</span>
            ) : (
              <span className="text-sm font-semibold text-warn">Open — nobody has claimed this team</span>
            )}
          </span>
        )}
        {!editing && (
          <span className="flex flex-shrink-0 items-center gap-1">
            {canRename && (
              <button
                type="button"
                onClick={() => {
                  setName(team.name);
                  setEditing(true);
                }}
                className="h-9 rounded-lg px-2 text-sm font-semibold text-muted hover:text-text"
              >
                Rename
              </button>
            )}
            {isCommissioner && (
              <>
                <button
                  type="button"
                  aria-label={`Move ${team.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => onMove(-1)}
                  className="h-9 w-9 rounded-lg bg-surface-2 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move ${team.name} down`}
                  disabled={busy || index === total - 1}
                  onClick={() => onMove(1)}
                  className="h-9 w-9 rounded-lg bg-surface-2 disabled:opacity-30"
                >
                  ↓
                </button>
              </>
            )}
          </span>
        )}
      </div>
      {isCommissioner && team.claimed && !editing && (
        <div className="flex items-center gap-2 pl-10 text-sm">
          {confirmRelease ? (
            <>
              <span className="text-warn">Free this team? {team.managerName} will need the invite link to claim one again.</span>
              <button
                type="button"
                onClick={() => {
                  setConfirmRelease(false);
                  onRelease();
                }}
                className="h-9 flex-shrink-0 rounded-lg bg-warn px-3 font-bold text-on-accent"
              >
                Free it
              </button>
              <button type="button" onClick={() => setConfirmRelease(false)} className="h-9 flex-shrink-0 rounded-lg border border-line px-3 font-semibold">
                Keep
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmRelease(true)} className="text-muted underline hover:text-text">
              Remove manager
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Teams in draft order (FR-03): who has claimed which slot, rename your own,
 * and — commissioner only — move teams, shuffle the order on the server, and
 * free a slot someone claimed by mistake.
 */
export function TeamsPanel({
  token,
  league,
  onChanged,
  onBusyChange,
}: {
  token: string;
  league: LeagueDetail;
  onChanged: () => Promise<void>;
  /** Lets the lobby hold Start while an order change is in flight, so nobody starts against an order they haven't seen yet. */
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusyState] = useState(false);
  const [shuffling, setShuffling] = useState(false);
  const setBusy = (b: boolean) => {
    setBusyState(b);
    onBusyChange(b);
  };
  const [error, setError] = useState("");
  const claimed = league.teams.filter((t) => t.claimed).length;
  const iHaveATeam = league.teams.some((t) => t.isMine);

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      await fn();
      // Wait for the re-read too: the order on screen must be the new one before anything else is allowed.
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work — try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const order = league.teams.map((t) => t.id);
    const target = index + delta;
    [order[index], order[target]] = [order[target]!, order[index]!];
    void run(() => api(token, "PUT", `/leagues/${league.id}/draft-order`, { order: order.map((teamId, i) => ({ teamId, draftNumber: i + 1 })) }));
  };

  return (
    <section aria-labelledby="teams" className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="teams" className="label">
          Teams & draft order · {claimed} of {league.teams.length} claimed
        </h2>
        {league.isCommissioner && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setShuffling(true);
              await run(() => api(token, "POST", `/leagues/${league.id}/draft-order/shuffle`));
              setShuffling(false);
            }}
            className="h-10 rounded-ctl border border-line px-3 text-sm font-semibold disabled:opacity-40"
          >
            {shuffling ? "Shuffling…" : "Shuffle order"}
          </button>
        )}
      </div>
      <ol className="flex flex-col gap-1.5">
        {league.teams.map((team, i) => (
          <TeamRow
            key={team.id}
            team={team}
            index={i}
            total={league.teams.length}
            canRename={team.isMine || league.isCommissioner}
            isCommissioner={league.isCommissioner}
            busy={busy}
            onRename={(name) => run(() => api(token, "PATCH", `/leagues/${league.id}/teams/${team.id}`, { name }))}
            onMove={(delta) => move(i, delta)}
            onRelease={() => void run(() => api(token, "DELETE", `/leagues/${league.id}/teams/${team.id}/manager`))}
          />
        ))}
      </ol>
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
      <p className="text-sm text-muted">
        Team 1 goes first.
        {league.isCommissioner && !iHaveATeam && league.inviteCode && (
          <>
            {" "}
            Drafting too?{" "}
            <Link to={`/join/${league.inviteCode}`} className="font-semibold text-accent underline">
              Claim a team for yourself
            </Link>
            .
          </>
        )}
      </p>
    </section>
  );
}
