import { currentLot } from "@draft-app/engine";
import type { DraftSnapshot } from "../../lib/contracts";
import { asEngineState } from "../../store/selectors";

export type MyTurn = {
  /** "bid" is shared with every eligible team, so it gets the 10-second warning but no "you're on the clock" cue. */
  kind: "nominate" | "bid" | "tie" | "pick";
  /** Changes whenever a new turn starts, so the same turn never alerts twice. */
  key: string;
  endsAt: number | null;
};

/**
 * What the viewer has to do right now, if anything (FR-20): nominate, bid on
 * the open lot, re-bid in a tie they're in, or make a snake/make-up pick.
 * Null once they've acted: after a bid or pass, the 10-second warning is pointless.
 */
export function myTurn(snapshot: DraftSnapshot): MyTurn | null {
  const me = snapshot.myTeamId;
  if (!me) return null;

  if (snapshot.phase === "snake" || snapshot.phase === "makeup") {
    return snapshot.snakePickTurnTeamId === me ? { kind: "pick", key: `pick:${snapshot.picks.length}`, endsAt: snapshot.snakePickEndsAt } : null;
  }
  if (snapshot.phase !== "auction") return null;

  if (snapshot.nominationTurnTeamId !== null) {
    if (snapshot.nominationTurnTeamId !== me) return null;
    const nominated = snapshot.lots.filter((l) => l.round === snapshot.auctionRound).length;
    return { kind: "nominate", key: `nominate:${snapshot.auctionRound}:${nominated}`, endsAt: snapshot.nominationEndsAt };
  }

  const lot = currentLot(asEngineState(snapshot));
  if (!lot) return null;
  const acted = (tieRound: number) => snapshot.bids.some((b) => b.lotId === lot.id && b.teamId === me && b.tieRound === tieRound && !b.superseded);
  if (lot.state === "tieRebid") {
    return lot.tiedTeamIds.includes(me) && !acted(lot.tieRound) ? { kind: "tie", key: `tie:${lot.id}:${lot.tieRound}`, endsAt: lot.endsAt } : null;
  }
  if (lot.state === "open") {
    return lot.eligibleTeamIds.includes(me) && !acted(0) ? { kind: "bid", key: `bid:${lot.id}`, endsAt: lot.endsAt } : null;
  }
  return null;
}
