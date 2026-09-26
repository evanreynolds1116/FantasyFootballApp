import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Socket } from "socket.io-client";
import type { DraftSnapshot, RevealedBid, RevealPayload } from "../lib/contracts";
import { createDraftSocket, joinDraft, resync } from "../lib/socket";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

/** How long a reveal stays on screen before every client falls back to the live view. SPEC.md's own worked example assumes ~10s. */
const REVEAL_DISPLAY_MS = 10_000;

type DraftContextValue = {
  snapshot: DraftSnapshot | null;
  status: ConnectionStatus;
  socket: Socket;
  /** Non-null for REVEAL_DISPLAY_MS after a lot:reveal — the only moment these bid amounts exist client-side. */
  reveal: RevealPayload | null;
};

const DraftContext = createContext<DraftContextValue | null>(null);

type RawSnapshot = Omit<DraftSnapshot, "myTeamId"> & { myTeamId?: string | null };
type RawReveal = { lotId: string; bids: RevealedBid[]; winnerTeamId: string | null };
type RawTieRevealed = { lotId: string; tieRound: number; bids: RevealedBid[] };
type RawAwarded = { lotId: string; teamId: string; playerId: string; price: number };

/**
 * Owns the one WS connection for a draft: joins on connect, applies every
 * `state:snapshot` it receives, and — for any *other* named event — asks the
 * server for a fresh snapshot via `resync` rather than hand-applying the
 * event client-side. The server stays the single source of truth; the
 * client never re-derives state transitions itself.
 */
export function DraftProvider({ token, draftId, children }: { token: string; draftId: string; children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  if (!socketRef.current) socketRef.current = createDraftSocket(token);
  const socket = socketRef.current;

  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [reveal, setReveal] = useState<RevealPayload | null>(null);

  useEffect(() => {
    let resyncScheduled = false;
    let hasConnectedBefore = false;
    let lastMyTeamId: string | null = null;
    let revealTimeout: ReturnType<typeof setTimeout> | null = null;
    // A tie's *final* round resolves via lot:tieRebidRevealed + lot:awarded
    // — never lot:reveal, which only fires for a lot's very first (untied)
    // close. Tracking the most recent tie-round reveal lets a matching
    // lot:awarded for the same lot reuse RevealScreen instead of silently
    // skipping straight to the next screen.
    let lastTieReveal: { lotId: string; bids: RevealedBid[] } | null = null;

    const armReveal = (payload: { lotId: string; bids: RevealedBid[]; winnerTeamId: string | null }) => {
      if (revealTimeout) clearTimeout(revealTimeout);
      const until = Date.now() + REVEAL_DISPLAY_MS;
      setReveal({ ...payload, until });
      revealTimeout = setTimeout(() => setReveal(null), REVEAL_DISPLAY_MS);
    };

    const scheduleResync = () => {
      if (resyncScheduled) return;
      resyncScheduled = true;
      queueMicrotask(() => {
        resyncScheduled = false;
        void resync(socket);
      });
    };

    const applySnapshot = (payload: unknown) => {
      const raw = payload as RawSnapshot;
      // The room-wide broadcast on admin:undo can't cheaply compute a
      // per-socket myTeamId, so it omits the field — team ownership never
      // changes mid-draft, so carrying the last-known value forward is safe.
      const myTeamId = raw.myTeamId !== undefined ? raw.myTeamId : lastMyTeamId;
      lastMyTeamId = myTeamId;
      setSnapshot({ ...raw, myTeamId } as DraftSnapshot);
    };

    const handleConnect = () => {
      void joinDraft(socket, draftId).then(() => {
        setStatus("connected");
        if (hasConnectedBefore) scheduleResync();
        hasConnectedBefore = true;
      });
    };
    const handleDisconnect = () => setStatus("reconnecting");
    const handleAny = (eventName: string, payload: unknown) => {
      if (eventName === "state:snapshot") {
        applySnapshot(payload);
        return;
      }
      if (eventName === "lot:reveal") {
        armReveal(payload as RawReveal);
      }
      if (eventName === "lot:tieRebidRevealed") {
        const raw = payload as RawTieRevealed;
        lastTieReveal = { lotId: raw.lotId, bids: raw.bids };
      }
      if (eventName === "lot:awarded") {
        const raw = payload as RawAwarded;
        if (lastTieReveal && lastTieReveal.lotId === raw.lotId) {
          armReveal({ lotId: raw.lotId, bids: lastTieReveal.bids, winnerTeamId: raw.teamId });
          lastTieReveal = null;
        }
      }
      scheduleResync();
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.onAny(handleAny);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.offAny(handleAny);
      socket.disconnect();
      if (revealTimeout) clearTimeout(revealTimeout);
    };
  }, [draftId, socket]);

  const value = useMemo<DraftContextValue>(() => ({ snapshot, status, socket, reveal }), [snapshot, status, socket, reveal]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft must be used within DraftProvider");
  return ctx;
}
