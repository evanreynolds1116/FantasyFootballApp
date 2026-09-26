import type { DraftSettings } from "@draft-app/engine";

/** Fired on window when the server answers 401 — the session expired or was signed out elsewhere. */
export const UNAUTHORIZED_EVENT = "draft-app:unauthorized";

/** Unauthenticated JSON POST for the sign-in steps. Throws ApiError with the server's message. */
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? "ERROR"), typeof data.message === "string" ? data.message : "Something went wrong.");
  return data as T;
}

export type VerifiedSession = { token: string; userId: string; next: string | null; needsName: boolean };

/** Emails a sign-in code and link to `email`. */
export function startSignIn(email: string, next?: string): Promise<{ ok: true }> {
  return publicPost("/auth/start", { email, ...(next ? { next } : {}) });
}

/** Trades the emailed code (with its email) or the link's token for a session. */
export function verifySignIn(proof: { email: string; code: string } | { token: string }): Promise<VerifiedSession> {
  return publicPost("/auth/verify", proof);
}

/** A watch-only session for the big board. */
export function startSpectating(draftId: string): Promise<{ token: string }> {
  return publicPost(`/drafts/${encodeURIComponent(draftId)}/spectate`, {});
}

export async function getAuthConfig(): Promise<{ devLogin: boolean }> {
  try {
    const res = await fetch("/auth/config");
    return res.ok ? ((await res.json()) as { devLogin: boolean }) : { devLogin: false };
  } catch {
    return { devLogin: false };
  }
}

export async function mintDevSession(displayName: string, email?: string): Promise<{ token: string; userId: string }> {
  const res = await fetch("/dev/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName, ...(email ? { email } : {}) }),
  });
  if (!res.ok) throw new Error("Could not start a session.");
  return res.json();
}

/** A non-2xx API response. `message` is the server's human-readable reason, suitable to show as-is. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** JSON request with the session's bearer token. Throws ApiError with the server's message on failure. */
export async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const code = typeof data.error === "string" ? data.error : "ERROR";
    // Schema (zod) failures carry a raw JSON issue list as their message — not something to show a person.
    const message =
      typeof data.message === "string" && !data.message.startsWith("[") ? data.message : res.status === 403 ? "You don't have access to that." : "Something went wrong.";
    throw new ApiError(res.status, code, message, Array.isArray(data.issues) ? (data.issues as string[]) : []);
  }
  return data as T;
}

/** Server-side problems as a list: the settings validator's issues when present, else the one message. */
export function serverErrorList(err: unknown, fallback: string): string[] {
  if (!(err instanceof ApiError)) return [fallback];
  return err.issues.length > 0 ? err.issues : [err.message];
}

// --- Setup & lobby shapes (mirrors apps/server/src/http/routes/{leagues,invites,players}.ts by hand) ---

export type LeagueSummary = {
  id: string;
  name: string;
  isCommissioner: boolean;
  myTeamName: string | null;
  teamCount: number;
  claimedCount: number;
  draft: { id: string; phase: string } | null;
};

export type LobbyTeam = { id: string; name: string; draftNumber: number; claimed: boolean; managerName: string | null; isMine: boolean };

export type LeagueDetail = {
  id: string;
  name: string;
  isCommissioner: boolean;
  commissionerName: string | null;
  inviteCode: string | null;
  settings: DraftSettings;
  teams: LobbyTeam[];
  playerCount: number;
  draft: { id: string; phase: string } | null;
};

export type InvitePreview = {
  leagueId: string;
  leagueName: string;
  commissionerName: string | null;
  isCommissioner: boolean;
  started: boolean;
  myTeamId: string | null;
  teams: { id: string; name: string; draftNumber: number; claimed: boolean; managerName: string | null }[];
};

export type PoolPlayer = { id: string; name: string; position: string; nflTeam: string | null; byeWeek: number | null; mflId: string | null; custom: boolean };

export type NewPlayer = { name: string; position: string; nflTeam?: string; byeWeek?: number; mflId?: string; custom?: boolean };
