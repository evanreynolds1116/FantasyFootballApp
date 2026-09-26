import { Link, Navigate, useParams } from "react-router-dom";
import { CommissionerConsole } from "../components/commish/CommissionerConsole";
import { ConnectionBadge } from "../components/primitives/ConnectionBadge";
import { useAuth } from "../lib/auth";
import { DraftProvider, useDraft } from "../store/DraftProvider";

function CommishScreen({ draftId }: { draftId: string }) {
  const { snapshot, status } = useDraft();

  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <Link to={`/draft/${draftId}`} className="text-sm font-semibold text-muted hover:text-text">
          ← Back to the draft
        </Link>
        <ConnectionBadge status={status} />
      </div>
      <div className="flex flex-grow flex-col px-4 md:px-8">
        {snapshot && !snapshot.isCommissioner ? (
          <div className="flex flex-grow items-center justify-center text-center text-muted">Only the league commissioner can open this console.</div>
        ) : (
          <CommissionerConsole />
        )}
      </div>
    </div>
  );
}

/** A separate route (and socket) from the draft screen, so a commissioner who's also drafting can keep both open side by side. */
export function CommishRoute() {
  const { draftId } = useParams<{ draftId: string }>();
  const { session } = useAuth();

  if (!draftId) return <Navigate to="/login" replace />;
  if (!session) return <Navigate to={`/login?draftId=${draftId}`} replace />;

  return (
    <DraftProvider token={session.token} draftId={draftId}>
      <CommishScreen draftId={draftId} />
    </DraftProvider>
  );
}
