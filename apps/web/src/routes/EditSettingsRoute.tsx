import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLeague } from "../components/lobby/useLeague";
import { SettingsForm } from "../components/setup/SettingsForm";
import { api, serverErrorList } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppPage, PageError, RequireSession } from "./AppPage";

/** After the start only the name can change (SPEC: settings lock when the draft starts). */
function RenameLeague({ token, leagueId, currentName }: { token: string; leagueId: string; currentName: string }) {
  const [name, setName] = useState(currentName);
  const [status, setStatus] = useState<{ kind: "idle" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(token, "PATCH", `/leagues/${leagueId}`, { name: trimmed });
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: serverErrorList(err, "Could not rename the league.")[0] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4">
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        League name
        <input
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setStatus({ kind: "idle" });
          }}
          className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !trimmed || trimmed === currentName} className="h-10 rounded-ctl bg-accent px-4 text-sm font-bold text-on-accent disabled:opacity-40">
          Rename league
        </button>
        {status.kind === "saved" && <span className="text-sm font-semibold text-success">Saved.</span>}
        {status.kind === "error" && (
          <span role="alert" className="text-sm font-semibold text-warn">
            {status.message}
          </span>
        )}
      </div>
    </form>
  );
}

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
      {league?.draft && (
        <div className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-muted">
          The draft has started, so the rules are locked. Clock lengths and how many bids are shown at each reveal can still change from the{" "}
          <Link to={`/draft/${league.draft.id}/commish`} className="font-semibold text-accent underline">
            commissioner console
          </Link>
          .
        </div>
      )}
      {league && league.isCommissioner && league.draft && <RenameLeague token={token} leagueId={leagueId} currentName={league.name} />}
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
