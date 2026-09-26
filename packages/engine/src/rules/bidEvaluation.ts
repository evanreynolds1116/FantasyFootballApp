import type { DraftState, Lot, TeamId } from "../model/types.js";

/**
 * A team's effective bid for `lot` as of `atTieRound`: their own bid at that
 * exact tie round if they submitted one, else falling back through earlier
 * rounds to their most recent standing bid ("if a tied team doesn't re-bid
 * in time, its previous bid stands"). Returns null if they never bid at all.
 */
export function effectiveBidAmount(
  state: DraftState,
  lot: Lot,
  teamId: TeamId,
  atTieRound: number = lot.tieRound,
): number | null {
  for (let round = atTieRound; round >= 0; round -= 1) {
    const bid = state.bids.find(
      (b) => b.lotId === lot.id && b.teamId === teamId && b.tieRound === round && !b.superseded,
    );
    // A pass is a standing "no bid" — it never competes.
    if (bid) return bid.pass ? null : bid.amount;
  }
  return null;
}

export type BidInfo = { teamId: TeamId; amount: number };

export type TopBidResult = {
  topAmount: number | null;
  winners: TeamId[];
  allBids: BidInfo[];
};

/** Evaluates the top effective bid among `teamIds` for `lot` at `atTieRound`. */
export function evaluateTopBid(
  state: DraftState,
  lot: Lot,
  teamIds: TeamId[],
  atTieRound: number = lot.tieRound,
): TopBidResult {
  const allBids: BidInfo[] = [];
  for (const teamId of teamIds) {
    const amount = effectiveBidAmount(state, lot, teamId, atTieRound);
    if (amount !== null) allBids.push({ teamId, amount });
  }
  if (allBids.length === 0) return { topAmount: null, winners: [], allBids };

  const topAmount = Math.max(...allBids.map((b) => b.amount));
  const winners = allBids.filter((b) => b.amount === topAmount).map((b) => b.teamId);
  return { topAmount, winners, allBids };
}

/** Sorted descending by amount, for reveal display. */
export function sortBidsDescending(bids: BidInfo[]): BidInfo[] {
  return [...bids].sort((a, b) => b.amount - a.amount);
}
