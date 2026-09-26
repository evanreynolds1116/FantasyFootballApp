import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLeague } from "../components/lobby/useLeague";
import { SettingsForm } from "../components/setup/SettingsForm";
import { api, serverErrorList } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppPage, PageError, RequireSession } from "./AppPage";

function EditSettings({ leagueId }: { leagueId: string }) {
  const token = useAuth().session!.token;
  const navigate = useNavigate();
  const { league, error } = useLeague(token, leagueId, { poll: false });
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  return (
    <AppPage wide>
      <Link to={`/league/${leagueId}`} className="text-sm font-semibold text-muted hover:text-text">
        ← Back to the lobby
      </Link>
      <h1 className="font-display text-[26px] font-extrabold uppercase">League settings</h1>
      {error && <PageError message={error.message} />}
      {league && !league.isCommissioner && <PageError message="Only the commissioner can change the league's settings." />}
      {league?.draft && <PageError message="The draft has started, so settings are locked. Clock lengths can still change from the commissioner console." />}
      {league && league.isCommissioner && !league.draft && (
        <SettingsForm
          initialName={league.name}
          initialSettings={league.settings}
          submitLabel="Save settings"
          serverErrors={serverErrors}
          onSubmit={async (name, settings) => {
            setServerErrors([]);
            try {
              await api(token, "PATCH", `/leagues/${leagueId}`, { name, settings });
              navigate(`/league/${leagueId}`);
            } catch (err) {
              setServerErrors(serverErrorList(err, "Could not save the settings."));
            }
          }}
        />
      )}
    </AppPage>
  );
}

export function EditSettingsRoute() {
  const { leagueId } = useParams<{ leagueId: string }>();
  return <RequireSession>{leagueId && <EditSettings leagueId={leagueId} />}</RequireSession>;
}
