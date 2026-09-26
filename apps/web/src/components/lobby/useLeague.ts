import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type LeagueDetail } from "../../lib/api";

/** How often the lobby re-reads the league — managers joining, the order changing, the draft starting. */
const POLL_MS = 3000;

/**
 * Loads GET /leagues/:id and, with `poll`, keeps re-reading it. The lobby
 * isn't in a draft's Socket.IO room (no draft exists until Start), so a short
 * poll is how it sees other people's changes. Errors after a successful load
 * keep the last good data on screen rather than blanking the lobby.
 */
export function useLeague(token: string, leagueId: string, { poll }: { poll: boolean }) {
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api<LeagueDetail>(token, "GET", `/leagues/${leagueId}`);
      loaded.current = true;
      setLeague(next);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && (!loaded.current || err.status === 403 || err.status === 404)) setError(err);
    }
  }, [token, leagueId]);

  useEffect(() => {
    void refresh();
    if (!poll) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [refresh, poll]);

  return { league, error, refresh };
}
