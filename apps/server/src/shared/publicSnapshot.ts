import { revealedBidIds, type DraftState } from "@draft-app/engine";

export type PublicBid = {
  id: string;
  lotId: string;
  teamId: string;
  tieRound: number;
  receivedAt: number;
  superseded: boolean;
  hasBid: true;
  /** Only present once this exact bid has been revealed to everyone — see the engine's revealedBidIds. */
  amount?: number;
  // Deliberately no `pass` field: a pass looks exactly like a bid to everyone
  // (the reveal only broadcasts how many teams passed, never who).
};

export type PublicDraftSnapshot = Omit<DraftState, "bids"> & { bids: PublicBid[] };

/**
 * The state every client receives. Bid amounts are included only for bids
 * the lot:reveal / lot:tieRebidRevealed broadcasts already showed everyone —
 * the engine's revealedBidIds decides that, so this boundary never invents
 * its own secrecy rule. Losing bids hidden by the reveal setting, a changed
 * bid's old amount, and bids on a lot voided mid-bidding never leave.
 */
export function toPublicSnapshot(state: DraftState): PublicDraftSnapshot {
  const revealed = revealedBidIds(state);
  const bids: PublicBid[] = state.bids.map((b) => ({
    id: b.id,
    lotId: b.lotId,
    teamId: b.teamId,
    tieRound: b.tieRound,
    receivedAt: b.receivedAt,
    superseded: b.superseded,
    hasBid: true,
    ...(revealed.has(b.id) ? { amount: b.amount } : {}),
  }));
  return { ...state, bids };
}
