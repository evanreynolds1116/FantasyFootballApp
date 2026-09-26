import { currentLot } from "@draft-app/engine";
import { Link, Navigate, useParams } from "react-router-dom";
import { BidScreen } from "../components/bid/BidScreen";
import { NominateScreen } from "../components/nominate/NominateScreen";
import { ConnectionBadge } from "../components/primitives/ConnectionBadge";
import { PausedBanner } from "../components/primitives/PausedBanner";
import { RevealScreen } from "../components/reveal/RevealScreen";
import { SnakePickScreen } from "../components/snake/SnakePickScreen";
import { TieRebidScreen } from "../components/tie/TieRebidScreen";
import { useAuth } from "../lib/auth";
import { asEngineState } from "../store/selectors";
import { DraftProvider, useDraft } from "../store/DraftProvider";

function DraftScreenRouter({ draftId }: { draftId: string }) {
  const { snapshot, status, reveal } = useDraft();
  const lot = snapshot ? currentLot(asEngineState(snapshot)) : undefined;

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <Link to="/" className="font-display text-lg font-bold uppercase">
          Draft Day
        </Link>
        <span className="flex items-center gap-4">
          <Link to={`/draft/${draftId}/rosters`} className="text-sm font-semibold text-muted hover:text-text">
            Rosters
          </Link>
          {snapshot?.isCommissioner && (
            <Link to={`/draft/${draftId}/commish`} className="text-sm font-semibold text-accent">
              Commissioner
            </Link>
          )}
          <ConnectionBadge status={status} />
        </span>
      </div>
      {snapshot && <PausedBanner paused={snapshot.paused} breakEndsAt={snapshot.breakEndsAt} />}
      <div className="flex flex-grow flex-col px-4 md:px-8">
        {!snapshot ? (
          <div className="flex flex-grow items-center justify-center text-muted">Loading draft…</div>
        ) : reveal ? (
          <RevealScreen reveal={reveal} />
        ) : lot?.state === "tieRebid" ? (
          <TieRebidScreen lot={lot} />
        ) : snapshot.phase === "auction" && snapshot.nominationTurnTeamId !== null ? (
          <NominateScreen />
        ) : snapshot.phase === "auction" ? (
          <BidScreen />
        ) : snapshot.phase === "snake" ? (
          <SnakePickScreen />
        ) : (
          <div className="flex flex-grow flex-col items-center justify-center gap-2 text-muted">
            <span className="font-display text-3xl font-extrabold uppercase text-text">{snapshot.phase}</span>
            <span>This screen isn&apos;t built yet.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DraftRoute() {
  const { draftId } = useParams<{ draftId: string }>();
  const { session } = useAuth();

  if (!draftId) return <Navigate to="/login" replace />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(`/draft/${draftId}`)}`} replace />;

  return (
    <DraftProvider token={session.token} draftId={draftId}>
      <DraftScreenRouter draftId={draftId} />
    </DraftProvider>
  );
}
