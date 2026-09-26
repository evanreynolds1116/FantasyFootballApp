import type { DraftState, Lot } from "../model/types.js";
import { evaluateTopBid, sortBidsDescending } from "../rules/bidEvaluation.js";
import { applyRevealTopN } from "../rules/reveal.js";

/** States a lot can only reach after its opening sealed round was revealed. */
const REVEALED_OPENING_STATES = new Set<Lot["state"]>(["tieRebid", "fallback", "awarded", "returnedToPool"]);
/** States in which the lot's last tie round has also been revealed. */
const FINISHED_STATES = new Set<Lot["state"]>(["fallback", "awarded", "returnedToPool"]);

/**
 * Ids of every bid whose amount has already been shown to everyone — exactly
 * what the lot:reveal and lot:tieRebidRevealed broadcasts carried, never more
 * (SPEC: "hidden losing bids never leave the server"):
 *
 * - Opening sealed round: only the top N by the reveal setting in force when
 *   that lot was revealed (`lot.revealTopN`), ranked exactly as the reveal
 *   ranked them. A lot closed without a reveal (voided mid-bidding) reveals
 *   nothing.
 * - Tie re-bid rounds: every amount, once that round has closed.
 * - Superseded bids (a team's changed bid): never.
 */
export function revealedBidIds(state: DraftState): Set<string> {
  const revealed = new Set<string>();
  const bidsByLot = new Map<string, DraftState["bids"]>();
  for (const b of state.bids) {
    if (b.superseded) continue;
    const list = bidsByLot.get(b.lotId) ?? [];
    list.push(b);
    bidsByLot.set(b.lotId, list);
  }

  for (const lot of state.lots) {
    const bids = bidsByLot.get(lot.id);
    if (!bids) continue;

    // Lots revealed before revealTopN was recorded fall back to the current setting.
    const openingRevealed = lot.revealTopN !== undefined || REVEALED_OPENING_STATES.has(lot.state);
    if (openingRevealed) {
      const { allBids } = evaluateTopBid(state, lot, lot.eligibleTeamIds, 0);
      const shown = applyRevealTopN(sortBidsDescending(allBids), lot.revealTopN ?? state.settings.revealTopN);
      for (const s of shown) {
        const bid = bids.find((b) => b.tieRound === 0 && b.teamId === s.teamId);
        if (bid) revealed.add(bid.id);
      }
    }

    for (const b of bids) {
      if (b.tieRound === 0) continue;
      if (b.tieRound < lot.tieRound || (b.tieRound === lot.tieRound && FINISHED_STATES.has(lot.state))) revealed.add(b.id);
    }
  }
  return revealed;
}
