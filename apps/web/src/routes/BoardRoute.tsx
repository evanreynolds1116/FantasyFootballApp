import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BigBoardScreen } from "../components/board/BigBoardScreen";
import { mintDevSession } from "../lib/api";
import { DraftProvider } from "../store/DraftProvider";

/**
 * Spectator entry point: "no login beyond the league's board link" (SPEC).
 * Every WS/HTTP path still requires a resolved session token today, so this
 * transparently mints a throw-away dev session per page load — kept in
 * component state only, never touching the manager's own localStorage
 * session. A real link-based spectator auth is a proper auth-phase concern.
 */
export function BoardRoute() {
  const { draftId } = useParams<{ draftId: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    mintDevSession("Spectator")
      .then((s) => setToken(s.token))
      .catch(() => setError("Could not connect to the draft."));
  }, []);

  if (!draftId) return null;
  if (error) return <div className="flex h-screen items-center justify-center bg-bg text-warn">{error}</div>;
  if (!token) return <div className="flex h-screen items-center justify-center bg-bg text-muted">Loading…</div>;

  return (
    <DraftProvider token={token} draftId={draftId}>
      <BigBoardScreen />
    </DraftProvider>
  );
}
