import { currentLot } from "@draft-app/engine";
import type { DraftSnapshot } from "../../lib/contracts";
import { asEngineState } from "../../store/selectors";

/** "Keenan Owens" → "K. Owens", as in the Commish mockup's undo label. Single names pass through. */
export function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

function teamNumber(snapshot: DraftSnapshot, teamId: string): string {
  const team = snapshot.teams.find((t) => t.id === teamId);
  return team ? String(team.draftNumber) : "?";
}

/**
 * Whichever single clock is live right now, as the engine's pause logic sees
 * it (lot, else nomination, else snake pick): `endsAt` while running,
 * `remainingMs` while frozen by a pause. Both null when nothing is timed.
 */
export function activeClock(snapshot: DraftSnapshot): { endsAt: number | null; remainingMs: number | null } {
  const lot = currentLot(asEngineState(snapshot));
  if (lot && (lot.state === "open" || lot.state === "tieRebid")) {
    return { endsAt: lot.endsAt, remainingMs: lot.remainingMs };
  }
  if (snapshot.nominationEndsAt !== null || snapshot.nominationRemainingMs !== null) {
    return { endsAt: snapshot.nominationEndsAt, remainingMs: snapshot.nominationRemainingMs };
  }
  if (snapshot.snakePickEndsAt !== null || snapshot.snakePickRemainingMs !== null) {
    return { endsAt: snapshot.snakePickEndsAt, remainingMs: snapshot.snakePickRemainingMs };
  }
  return { endsAt: null, remainingMs: null };
}

/** The status line's "where are we" part, e.g. "Auction · R3 · Lot 5" — the clock is appended by the caller. */
export function phaseSummary(snapshot: DraftSnapshot): string {
  switch (snapshot.phase) {
    case "setup":
      return "Not started";
    case "auction": {
      if (snapshot.nominationTurnTeamId !== null) {
        return `Auction · R${snapshot.auctionRound} · Team ${teamNumber(snapshot, snapshot.nominationTurnTeamId)} nominating`;
      }
      const lot = currentLot(asEngineState(snapshot));
      return lot ? `Auction · R${lot.round} · Lot ${lot.orderInRound}` : `Auction · R${snapshot.auctionRound}`;
    }
    case "snake":
      return `Snake · R${snapshot.snakeRound} · Pick ${snapshot.picks.length + 1}`;
    case "makeup":
      return `Make-up · R${snapshot.makeupRound} · Pick ${snapshot.picks.length + 1}`;
    case "complete":
      return "Draft complete";
  }
}

/**
 * Names exactly what admin:undo would remove (UI.md: "naming exactly what it
 * undoes"), from the same `lastAwardOrPick` pointer the engine's undo uses.
 * null when there's nothing to undo.
 */
export function undoDescription(snapshot: DraftSnapshot): string | null {
  const last = snapshot.lastAwardOrPick;
  if (!last) return null;
  const pick = snapshot.picks.find((p) => p.id === last.pickId);
  if (!pick) return null;

  const player = snapshot.players.find((p) => p.id === pick.playerId);
  const playerName = player ? shortPlayerName(player.name) : "a player";
  const team = `Team ${teamNumber(snapshot, pick.teamId)}`;

  if (last.kind === "award") {
    const lot = last.lotId ? snapshot.lots.find((l) => l.id === last.lotId) : undefined;
    // Mockup wording ("Lot 4") within the current round; name the round too once play has moved past it.
    const where = !lot ? "Last lot" : lot.round === snapshot.auctionRound && snapshot.phase === "auction" ? `Lot ${lot.orderInRound}` : `R${lot.round} Lot ${lot.orderInRound}`;
    return `${where}, ${team} won ${playerName} for $${pick.price ?? 0}`;
  }
  return `Pick ${pick.pickNo}, ${team} took ${playerName}`;
}

/** What happens after an undo, spelled out in the confirm step so the commissioner isn't surprised. */
export function undoConsequence(snapshot: DraftSnapshot): string {
  return snapshot.lastAwardOrPick?.kind === "award"
    ? "The winner gets their money and auction spot back, the player goes back into the pool, and the draft pauses. Tap Resume when everyone's ready."
    : "The pick is removed and the player goes back into the pool.";
}
