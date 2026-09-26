import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type LeagueDetail } from "../../lib/api";

/** Everything that must be true before Start works; mirrors the server's own checks so the button says why it's disabled. */
export function startBlockers(league: LeagueDetail): string[] {
  const blockers: string[] = [];
  const needed = league.settings.teamCount * league.settings.rosterSize;
  if (league.teams.length !== league.settings.teamCount) blockers.push(`Settings say ${league.settings.teamCount} teams but the league has ${league.teams.length}.`);
  if (league.playerCount < needed) blockers.push(`Add at least ${needed - league.playerCount} more players to the pool (${needed} needed to fill every roster).`);
  return blockers;
}

/**
 * What happens to teams nobody has claimed, for this league's clocks:
 * nomination expiry always auto-nominates, pick expiry follows the league's
 * setting, and a clock that's off never expires — the draft waits forever.
 */
export function unclaimedWarning(league: LeagueDetail): string | null {
  const open = league.teams.filter((t) => !t.claimed);
  if (open.length === 0) return null;
  const s = league.settings;
  const who = open.length === 1 ? `Team ${open[0]!.draftNumber} has no manager` : `${open.length} teams (${open.map((t) => `#${t.draftNumber}`).join(", ")}) have no manager`;
  const parts = [`${who}, so nobody can bid for ${open.length === 1 ? "it" : "them"}.`];
  const hasAuction = s.auctionSpots > 0;
  const hasPicks = s.auctionSpots < s.rosterSize || (hasAuction && s.brokeTeamsFillAtEnd);
  const stalled: string[] = [];
  if (hasAuction) {
    if (s.nominationClockSec === "off") stalled.push("nomination");
    else parts.push("Their nominations are made automatically when the nomination clock runs out.");
  }
  if (hasPicks) {
    if (s.pickClockSec === "off") stalled.push("pick");
    else parts.push(s.pickExpiryAction === "autoPick" ? "Their snake picks are auto-picked when the pick clock runs out." : "Their snake picks are skipped when the pick clock runs out.");
  }
  if (stalled.length > 0) parts.push(`With the ${stalled.join(" and ")} clock off, the draft will stop at their turn until you turn it on from the console.`);
  return parts.join(" ");
}

/**
 * Commissioner's Start (SPEC Flow 1 step 5). Unclaimed teams don't block it
 * — useful for a mock draft — but the button asks for a second tap that says
 * exactly what that means.
 */
export function StartPanel({ token, league, held }: { token: string; league: LeagueDetail; held: boolean }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!league.isCommissioner) {
    return (
      <section className="rounded-panel border border-dashed border-line-dashed p-4 text-center text-muted">
        Waiting for {league.commissionerName ?? "the commissioner"} to start the draft. This page moves you into it automatically.
      </section>
    );
  }

  const blockers = startBlockers(league);
  const unclaimed = league.teams.filter((t) => !t.claimed);
  const warning = unclaimedWarning(league);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      const { draftId } = await api<{ draftId: string }>(token, "POST", `/leagues/${league.id}/start`);
      navigate(`/draft/${draftId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the draft.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="start" className="flex flex-col gap-2.5 rounded-panel border border-line bg-surface p-4">
      <h2 id="start" className="label">
        Start the draft
      </h2>
      {blockers.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-warn">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <span className="text-sm text-muted">Starting locks the settings, teams, order and player pool. Clock lengths can still change from the commissioner console.</span>
      )}
      {confirming && warning && (
        <div role="alert" className="rounded-ctl border border-warn-border bg-warn-bg p-3 text-sm text-warn">
          {warning}
        </div>
      )}
      {error && (
        <div role="alert" className="text-sm font-semibold text-warn">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={blockers.length > 0 || busy || held}
          onClick={() => (unclaimed.length > 0 && !confirming ? setConfirming(true) : void start())}
          className="h-14 flex-grow rounded-panel bg-accent text-lg font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40"
        >
          {busy ? "Starting…" : confirming ? "Start anyway" : "Start the draft"}
        </button>
        {confirming && (
          <button type="button" onClick={() => setConfirming(false)} className="h-14 rounded-panel border border-line px-4 font-semibold">
            Wait
          </button>
        )}
      </div>
    </section>
  );
}
