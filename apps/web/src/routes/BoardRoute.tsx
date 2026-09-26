import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { BigBoardScreen } from "../components/board/BigBoardScreen";
import { startSpectating } from "../lib/api";
import { DraftProvider } from "../store/DraftProvider";

/**
 * Spectator entry point: "no login beyond the league's board link" (SPEC).
 * Gets a watch-only session for this draft per page load — kept in component
 * state only, never touching the manager's own stored session.
 */
export function BoardRoute() {
  const { draftId } = useParams<{ draftId: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!draftId) return;
    startSpectating(draftId)
      .then((s) => setToken(s.token))
      .catch(() => setError("Could not connect to the draft. Check the board link."));
  }, [draftId]);

  if (!draftId) return null;
  if (error) return <div className="flex h-screen items-center justify-center bg-bg text-warn">{error}</div>;
  if (!token) return <div className="flex h-screen items-center justify-center bg-bg text-muted">Loading…</div>;

  return (
    <DraftProvider token={token} draftId={draftId}>
      <BigBoardScreen />
    </DraftProvider>
  );
}
