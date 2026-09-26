import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { emitIntent } from "../../lib/socket";

type Options = {
  socket: Socket;
  lotId: string;
  minBid: number;
  budget: number;
  /** Whether the server already has a standing (non-superseded) bid from us on this lot. */
  hasServerBid: boolean;
};

export type BidForm = {
  amount: string;
  error: string;
  /** Non-null once submitted this session; null if we merely know a bid exists server-side (e.g. after reconnect) without remembering the amount. */
  submittedAmount: number | null;
  hasBid: boolean;
  isSubmitted: boolean;
  /** True while editing a bid that's already standing server-side — it stays in if the clock runs out before you resubmit. */
  previousBidStands: boolean;
  setAmount: (value: string) => void;
  submit: () => Promise<void>;
  change: () => void;
};

/**
 * Client-side min/budget hints only — the server's ack code is always the
 * final word (BID_TOO_LOW, OVER_BUDGET, POSITION_LIMIT, LOT_CLOSED, ...).
 * Bid amounts are never revealed back by the server before the lot resolves
 * — not even to the bidder — so a submittedAmount surviving a reconnect
 * mid-lot is not recoverable; `hasBid` alone still reflects server truth.
 */
export function useBidForm({ socket, lotId, minBid, budget, hasServerBid }: Options): BidForm {
  const [amount, setAmountRaw] = useState("");
  const [error, setError] = useState("");
  const [submittedAmount, setSubmittedAmount] = useState<number | null>(null);
  // hasServerBid reflects the server's standing bid and stays true across a
  // "Change bid" click (the old bid still stands until a new one replaces
  // it) — this is the local override that lets the form come back even
  // though the server still says "you have a bid in."
  const [isEditing, setIsEditing] = useState(false);
  const lastLotId = useRef(lotId);

  useEffect(() => {
    if (lastLotId.current !== lotId) {
      lastLotId.current = lotId;
      setAmountRaw("");
      setError("");
      setSubmittedAmount(null);
      setIsEditing(false);
    }
  }, [lotId]);

  const setAmount = (value: string) => {
    setAmountRaw(value.replace(/[^0-9]/g, "").slice(0, 6));
    setError("");
  };

  const submit = async () => {
    const n = parseInt(amount || "0", 10);
    if (n < minBid) {
      setError(`Minimum bid is $${minBid}`);
      return;
    }
    if (n > budget) {
      setError(`That is more than your $${budget} budget`);
      return;
    }
    const ack = await emitIntent(socket, "bid:submit", { lotId, amount: n });
    if (!ack.ok) {
      setError(ack.message);
      return;
    }
    setSubmittedAmount(n);
    setIsEditing(false);
    setError("");
  };

  const change = () => {
    setSubmittedAmount(null);
    setAmountRaw("");
    setIsEditing(true);
  };

  return {
    amount,
    error,
    submittedAmount,
    hasBid: hasServerBid,
    isSubmitted: !isEditing && (hasServerBid || submittedAmount !== null),
    previousBidStands: isEditing && hasServerBid,
    setAmount,
    submit,
    change,
  };
}
