import type { DraftState, LotState } from "@draft-app/engine";

export type PublicBid = {
  id: string;
  lotId: string;
  teamId: string;
  tieRound: number;
  receivedAt: number;
  superseded: boolean;
  hasBid: true;
  /** Only present once this bid's tie round has actually been revealed — see isBidVisible. */
  amount?: number;
};

export type PublicDraftSnapshot = Omit<DraftState, "bids"> & { bids: PublicBid[] };

/**
 * Whether a bid at `bidTieRound` on a lot currently at `lotTieRound`/`lotState`
 * has already been revealed to everyone — mirrors exactly what the
 * corresponding lot:reveal / lot:tieRebidRevealed / lot:awarded broadcasts
 * already sent, never a new secrecy rule invented at the snapshot boundary.
 */
export function isBidVisible(lotState: LotState, lotTieRound: number, bidTieRound: number): boolean {
  switch (lotState) {
    case "queued":
    case "open":
      // Nothing revealed yet.
      return false;
    case "paused":
    case "tieRebid":
      // Earlier rounds were revealed when they closed; the current round hasn't closed yet.
      return bidTieRound < lotTieRound;
    case "fallback":
    case "awarded":
    case "returnedToPool":
    case "cancelled":
      // The round that led here was revealed (tie.ts always reveals before falling back or awarding).
      return true;
    case "closed":
    case "revealed":
      // Transient, never observed at rest (the engine always finishes resolving within one reduce() call).
      return false;
  }
}

export function toPublicSnapshot(state: DraftState): PublicDraftSnapshot {
  const lotById = new Map(state.lots.map((l) => [l.id, l]));

  const bids: PublicBid[] = state.bids.map((b) => {
    const lot = lotById.get(b.lotId);
    const visible = lot ? isBidVisible(lot.state, lot.tieRound, b.tieRound) : false;
    return {
      id: b.id,
      lotId: b.lotId,
      teamId: b.teamId,
      tieRound: b.tieRound,
      receivedAt: b.receivedAt,
      superseded: b.superseded,
      hasBid: true,
      ...(visible ? { amount: b.amount } : {}),
    };
  });

  return { ...state, bids };
}
