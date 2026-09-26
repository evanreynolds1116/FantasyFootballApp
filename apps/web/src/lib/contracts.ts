import type { DraftState, ErrorCode } from "@draft-app/engine";

/**
 * Hand-mirrored copies of apps/server's transport shapes (server isn't set
 * up as an importable package — it's Node-only and has no "exports" field).
 * Keep these in sync with apps/server/src/shared/publicSnapshot.ts and
 * apps/server/src/ws/intentHandlers.ts by hand.
 */
export type PublicBid = {
  id: string;
  lotId: string;
  teamId: string;
  tieRound: number;
  receivedAt: number;
  superseded: boolean;
  hasBid: true;
  /** Only present once this bid's tie round has actually been revealed. */
  amount?: number;
};

/** The snapshot sent as `state:snapshot` — DraftState with bids scrubbed for secrecy, plus the viewer's own team. */
export type DraftSnapshot = Omit<DraftState, "bids"> & {
  bids: PublicBid[];
  /** null for a spectator, or a manager who owns no team in this league. */
  myTeamId: string | null;
  /** Whether this viewer is the league commissioner — only decides whether to offer the console; the server re-checks every admin intent. */
  isCommissioner: boolean;
  /** Teams whose manager currently has the draft open. Live connection state, not draft state — kept current by `presence:update`. */
  connectedTeamIds: string[];
};

export type AckErrorCode = ErrorCode | "FORBIDDEN" | "NOT_JOINED" | "INVALID_PAYLOAD" | "SERVER_ERROR";

export type Ack = { ok: true } | { ok: false; code: AckErrorCode; message: string };

export type JoinAck = { ok: true } | { ok: false; error: string };

export type RevealedBid = { teamId: string; amount: number };

/**
 * The `lot:reveal` event's payload, plus a client-assigned `until` timestamp
 * (see DraftProvider) — this is the ONE moment these bid amounts are ever
 * transmitted; the engine resolves open → closed → revealed → awarded in a
 * single reduce() call, so `revealed` is never a state a snapshot rests in.
 */
export type RevealPayload = {
  lotId: string;
  bids: RevealedBid[];
  winnerTeamId: string | null;
  /** How many teams passed on the lot — a count only, never who. */
  passes: number;
  until: number;
};
