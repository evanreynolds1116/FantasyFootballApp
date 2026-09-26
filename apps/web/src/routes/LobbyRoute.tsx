import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { InvitePanel } from "../components/lobby/InvitePanel";
import { MyQueuePanel } from "../components/lobby/MyQueuePanel";
import { PlayerPoolPanel } from "../components/lobby/PlayerPoolPanel";
import { StartPanel } from "../components/lobby/StartPanel";
import { TeamsPanel } from "../components/lobby/TeamsPanel";
import { useLeague } from "../components/lobby/useLeague";
import { summarizeRules } from "../components/setup/ruleSummary";
import { useAuth } from "../lib/auth";
import { AppPage, PageError, RequireSession } from "./AppPage";

/**
 * Lobby (SPEC screens: "teams joined / ready, draft order, invite link,
 * start button"). Everyone in the league sees it; commissioner-only controls
 * appear inline. When the draft starts, everyone watching is moved into it.
 */
function Lobby({ leagueId }: { leagueId: string }) {
  const token = useAuth().session!.token;
  const navigate = useNavigate();
  const { league, error, refresh } = useLeague(token, leagueId, { poll: true });
  const [teamsBusy, setTeamsBusy] = useState(false);

  // Follow the draft only when it starts while this page is open — someone
  // coming back to a started league's lobby on purpose isn't bounced away.
  const sawNotStarted = useRef(false);
  useEffect(() => {
    if (!league) return;
    if (!league.draft) sawNotStarted.current = true;
    else if (sawNotStarted.current) navigate(`/draft/${league.draft.id}`);
  }, [league, navigate]);

  if (error) {
    return (
      <AppPage>
        <PageError message={error.status === 403 ? "You're not in this league yet. Open the invite link your commissioner sent to claim a team." : error.message} />
        <Link to="/" className="text-sm font-semibold text-muted hover:text-text">
          ← Your leagues
        </Link>
      </AppPage>
    );
  }
  if (!league) {
    return (
      <AppPage>
        <div className="text-muted">Loading the lobby…</div>
      </AppPage>
    );
  }

  const locked = league.draft !== null;
  const needed = league.settings.teamCount * league.settings.rosterSize;

  return (
    <AppPage wide>
      <div className="flex flex-col gap-1">
        <span className="label">Lobby</span>
        <h1 className="font-display text-[30px] font-extrabold uppercase leading-tight">{league.name}</h1>
        {league.commissionerName && <span className="text-muted">Commissioner: {league.commissionerName}</span>}
      </div>

      {locked && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border-2 border-accent bg-surface px-4 py-3">
          <span className="font-semibold">{league.draft!.phase === "complete" ? "This draft is complete." : "The draft is live."}</span>
          <Link to={`/draft/${league.draft!.id}`} className="flex h-11 items-center rounded-ctl bg-accent px-4 font-bold text-on-accent">
            Go to the draft
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          {!locked && <StartPanel token={token} league={league} held={teamsBusy} />}
          <TeamsPanel token={token} league={league} onChanged={refresh} onBusyChange={setTeamsBusy} />
          {!locked && league.teams.some((t) => t.isMine) && <MyQueuePanel token={token} leagueId={league.id} playerCount={league.playerCount} />}
        </div>
        <div className="flex flex-col gap-4">
          <InvitePanel token={token} leagueId={league.id} inviteCode={league.inviteCode} isCommissioner={league.isCommissioner} locked={locked} onChanged={() => void refresh()} />
          <PlayerPoolPanel
            token={token}
            leagueId={league.id}
            playerCount={league.playerCount}
            needed={needed}
            isCommissioner={league.isCommissioner}
            locked={locked}
            onChanged={() => void refresh()}
          />
          <section aria-labelledby="rules" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <h2 id="rules" className="label">
                Rules
              </h2>
              {league.isCommissioner && !locked && (
                <Link to={`/league/${league.id}/settings`} className="text-sm font-semibold text-accent underline">
                  Edit settings
                </Link>
              )}
            </div>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
              {summarizeRules(league.settings).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppPage>
  );
}

export function LobbyRoute() {
  const { leagueId } = useParams<{ leagueId: string }>();
  return <RequireSession>{leagueId && <Lobby leagueId={leagueId} />}</RequireSession>;
}
