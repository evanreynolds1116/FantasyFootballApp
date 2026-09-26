import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { REVEAL_HOLD_MS, type CommishEdit } from "@draft-app/engine";
import type { Socket } from "socket.io-client";
import type { DraftSnapshot, RevealedBid, RevealPayload } from "../lib/contracts";
import { createDraftSocket, joinDraft, resync } from "../lib/socket";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting";

/** How long a commissioner edit's notice stays up. */
const NOTICE_DISPLAY_MS = 8_000;

/** How long a reveal stays on screen: exactly as long as the server holds the next clock for it. */
const REVEAL_DISPLAY_MS = REVEAL_HOLD_MS;

type DraftContextValue = {
  snapshot: DraftSnapshot | null;
  status: ConnectionStatus;
  socket: Socket;
  /** Non-null for REVEAL_DISPLAY_MS after a lot:reveal — the only moment these bid amounts exist client-side. */
  reveal: RevealPayload | null;
  /** True when the server refused the join because no such draft exists (e.g. a mistyped link). */
  notFound: boolean;
  /** The latest commissioner edit, for NOTICE_DISPLAY_MS after it happens — every screen tells the league. */
  notice: CommishEdit | null;
};

const DraftContext = createContext<DraftContextValue | null>(null);

type RawSnapshot = Omit<DraftSnapshot, "myTeamId" | "isCommissioner" | "connectedTeamIds" | "myQueue"> & {
  myTeamId?: string | null;
  myQueue?: string[];
  isCommissioner?: boolean;
  connectedTeamIds?: string[];
};
type RawReveal = { lotId: string; bids: RevealedBid[]; winnerTeamId: string | null; passes?: number };
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
  const [notFound, setNotFound] = useState(false);
  const [notice, setNotice] = useState<CommishEdit | null>(null);

  useEffect(() => {
    let resyncScheduled = false;
    let hasConnectedBefore = false;
    let lastMyTeamId: string | null = null;
    let lastIsCommissioner = false;
    let lastConnectedTeamIds: string[] = [];
    let lastMyQueue: string[] = [];
    let revealTimeout: ReturnType<typeof setTimeout> | null = null;
    let noticeTimeout: ReturnType<typeof setTimeout> | null = null;
    // A tie's *final* round resolves via lot:tieRebidRevealed + lot:awarded
    // — never lot:reveal, which only fires for a lot's very first (untied)
    // close. Tracking the most recent tie-round reveal lets a matching
    // lot:awarded for the same lot reuse RevealScreen instead of silently
    // skipping straight to the next screen.
    let lastTieReveal: { lotId: string; bids: RevealedBid[] } | null = null;

    const armReveal = (payload: { lotId: string; bids: RevealedBid[]; winnerTeamId: string | null; passes?: number; afterTie?: boolean }) => {
      if (revealTimeout) clearTimeout(revealTimeout);
      const until = Date.now() + REVEAL_DISPLAY_MS;
      setReveal({ ...payload, passes: payload.passes ?? 0, afterTie: payload.afterTie ?? false, until });
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
      // The room-wide broadcast on admin:undo can't cheaply compute the
      // per-socket fields, so it omits them — team ownership and the
      // commissioner never change mid-draft, and presence has its own
      // presence:update event, so carrying the last-known values forward is safe.
      const myTeamId = raw.myTeamId !== undefined ? raw.myTeamId : lastMyTeamId;
      const isCommissioner = raw.isCommissioner ?? lastIsCommissioner;
      const connectedTeamIds = raw.connectedTeamIds ?? lastConnectedTeamIds;
      // Room-wide snapshots (undo) carry no queue at all — queues are private.
      const myQueue = raw.myQueue ?? lastMyQueue;
      lastMyTeamId = myTeamId;
      lastIsCommissioner = isCommissioner;
      lastConnectedTeamIds = connectedTeamIds;
      lastMyQueue = myQueue;
      setSnapshot({ ...raw, myTeamId, isCommissioner, connectedTeamIds, myQueue } as DraftSnapshot);
    };

    const applyPrivate = (payload: unknown) => {
      const { queue } = payload as { queue?: string[] };
      if (!queue) return;
      lastMyQueue = queue;
      setSnapshot((prev) => (prev ? { ...prev, myQueue: queue } : prev));
    };

    const applyPresence = (payload: unknown) => {
      const { connectedTeamIds } = payload as { connectedTeamIds: string[] };
      lastConnectedTeamIds = connectedTeamIds;
      setSnapshot((prev) => (prev ? { ...prev, connectedTeamIds } : prev));
    };

    const handleConnect = () => {
      void joinDraft(socket, draftId).then((ack) => {
        if (!ack.ok && ack.error === "NOT_FOUND") {
          setNotFound(true);
          return;
        }
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
      // Presence isn't draft state (no version bump), so it's applied as-is
      // rather than triggering a resync like every other event.
      if (eventName === "presence:update") {
        applyPresence(payload);
        return;
      }
      // Sent only to this manager's own sockets; nothing else changed, so no resync.
      if (eventName === "you:private") {
        applyPrivate(payload);
        return;
      }
      if (eventName === "lot:reveal") {
        armReveal(payload as RawReveal);
      }
      if (eventName === "commish:edit") {
        if (noticeTimeout) clearTimeout(noticeTimeout);
        setNotice((payload as { edit: CommishEdit }).edit);
        noticeTimeout = setTimeout(() => setNotice(null), NOTICE_DISPLAY_MS);
      }
      if (eventName === "lot:tieRebidRevealed") {
        const raw = payload as RawTieRevealed;
        lastTieReveal = { lotId: raw.lotId, bids: raw.bids };
      }
      if (eventName === "lot:awarded") {
        const raw = payload as RawAwarded;
        if (lastTieReveal && lastTieReveal.lotId === raw.lotId) {
          armReveal({ lotId: raw.lotId, bids: lastTieReveal.bids, winnerTeamId: raw.teamId, afterTie: true });
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
      if (noticeTimeout) clearTimeout(noticeTimeout);
    };
  }, [draftId, socket]);

  const value = useMemo<DraftContextValue>(() => ({ snapshot, status, socket, reveal, notFound, notice }), [snapshot, status, socket, reveal, notFound, notice]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

/**
 * When the 10-second "back in" countdown after a Resume ends, or null. Safe
 * outside a DraftProvider (returns null), so useCountdown can read it.
 */
export function useResumeHold(): number | null {
  return useContext(DraftContext)?.snapshot?.resumeHoldUntil ?? null;
}

/** Until when every draft clock holds: a back-in countdown or a reveal still playing. Null when neither. */
export function useClockHold(): number | null {
  const snapshot = useContext(DraftContext)?.snapshot;
  const hold = Math.max(snapshot?.resumeHoldUntil ?? 0, snapshot?.revealHoldUntil ?? 0);
  return hold > 0 ? hold : null;
}

export function useDraft(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft must be used within DraftProvider");
  return ctx;
}
