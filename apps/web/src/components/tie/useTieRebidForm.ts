import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { emitIntent } from "../../lib/socket";

type Options = {
  socket: Socket;
  lotId: string;
  tieRound: number;
  minRequired: number;
  budget: number;
  hasServerBid: boolean;
};

export type TieRebidForm = {
  amount: string;
  error: string;
  submittedAmount: number | null;
  isSubmitted: boolean;
  previousBidStands: boolean;
  setAmount: (value: string) => void;
  submit: () => Promise<void>;
  change: () => void;
};

/** Same shape/behavior as useBidForm (see its comments) — mirrored rather than shared since tie:rebid's validation (min = own previous + tie raise) differs from bid:submit's. */
export function useTieRebidForm({ socket, lotId, tieRound, minRequired, budget, hasServerBid }: Options): TieRebidForm {
  const [amount, setAmountRaw] = useState(String(minRequired));
  const [error, setError] = useState("");
  const [submittedAmount, setSubmittedAmount] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const lastKey = useRef(`${lotId}:${tieRound}`);

  useEffect(() => {
    const key = `${lotId}:${tieRound}`;
    if (lastKey.current !== key) {
      lastKey.current = key;
      setAmountRaw(String(minRequired));
      setError("");
      setSubmittedAmount(null);
      setIsEditing(false);
    }
  }, [lotId, tieRound, minRequired]);

  const setAmount = (value: string) => {
    setAmountRaw(value.replace(/[^0-9]/g, "").slice(0, 6));
    setError("");
  };

  const submit = async () => {
    const n = parseInt(amount || "0", 10);
    if (n < minRequired) {
      setError(`Must be at least $${minRequired}`);
      return;
    }
    if (n > budget) {
      setError(`That is more than your $${budget} budget`);
      return;
    }
    const ack = await emitIntent(socket, "tie:rebid", { lotId, amount: n });
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
    setAmountRaw(String(minRequired));
    setIsEditing(true);
  };

  return {
    amount,
    error,
    submittedAmount,
    isSubmitted: !isEditing && (hasServerBid || submittedAmount !== null),
    previousBidStands: isEditing && hasServerBid,
    setAmount,
    submit,
    change,
  };
}
