import type { ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ConnectionBadge } from "../components/primitives/ConnectionBadge";
import { PausedBanner } from "../components/primitives/PausedBanner";
import { useAuth } from "../lib/auth";
import { DraftProvider, useDraft } from "../store/DraftProvider";

function Shell({ draftId, children }: { draftId: string; children: ReactNode }) {
  const { snapshot, status } = useDraft();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <Link to={`/draft/${draftId}`} className="text-sm font-semibold text-muted hover:text-text">
          ← Back to the draft
        </Link>
        <ConnectionBadge status={status} />
      </div>
      {snapshot && (
        <div className="px-4 pt-3 empty:hidden md:px-8">
          <PausedBanner paused={snapshot.paused} breakEndsAt={snapshot.breakEndsAt} />
        </div>
      )}
      <div className="flex flex-grow flex-col px-4 md:px-8">{children}</div>
    </div>
  );
}

/**
 * A secondary draft screen (commissioner console, rosters & budgets) on its
 * own route and socket, so it can sit in another tab next to the live draft
 * screen. Same login requirement as /draft/:draftId.
 */
export function DraftSubpage({ children }: { children: ReactNode }) {
  const { draftId } = useParams<{ draftId: string }>();
  const { session } = useAuth();

  if (!draftId) return <Navigate to="/login" replace />;
  if (!session) return <Navigate to={`/login?draftId=${draftId}`} replace />;

  return (
    <DraftProvider token={session.token} draftId={draftId}>
      <Shell draftId={draftId}>{children}</Shell>
    </DraftProvider>
  );
}
