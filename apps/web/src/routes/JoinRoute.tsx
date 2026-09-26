import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, type InvitePreview } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppPage, PageError, RequireSession } from "./AppPage";

/** FR-02: open the league's invite link, pick an unclaimed team, name it. */
function Join({ code }: { code: string }) {
  const token = useAuth().session!.token;
  const navigate = useNavigate();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvite(await api<InvitePreview>(token, "GET", `/invites/${code}`));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not open this invite.");
    }
  }, [token, code]);

  useEffect(() => {
    void load();
  }, [load]);

  if (invite?.myTeamId) return <Navigate to={`/league/${invite.leagueId}`} replace />;

  const claim = async () => {
    if (!chosen || !invite) return;
    setBusy(true);
    setError("");
    try {
      await api(token, "POST", `/invites/${code}/claim`, { teamId: chosen, ...(teamName.trim() ? { name: teamName.trim() } : {}) });
      navigate(`/league/${invite.leagueId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not claim that team.");
      if (err instanceof ApiError && err.code === "TEAM_TAKEN") {
        setChosen(null);
        void load();
      }
    } finally {
      setBusy(false);
    }
  };

  const open = invite?.teams.filter((t) => !t.claimed) ?? [];

  return (
    <AppPage>
      {loadError && (
        <>
          <PageError message={loadError} />
          <Link to="/" className="text-sm font-semibold text-muted hover:text-text">
            ← Your leagues
          </Link>
        </>
      )}
      {!invite && !loadError && <div className="text-muted">Opening invite…</div>}
      {invite && (
        <>
          <div className="flex flex-col gap-1">
            <span className="label">You&apos;re invited to</span>
            <h1 className="font-display text-[30px] font-extrabold uppercase leading-tight">{invite.leagueName}</h1>
            {invite.commissionerName && <span className="text-muted">Commissioner: {invite.commissionerName}</span>}
          </div>

          {invite.started ? (
            <PageError message="This league's draft has already started, so no more teams can be claimed." />
          ) : open.length === 0 ? (
            <PageError message="Every team in this league has been claimed. Ask the commissioner to add a team or free one up." />
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="label mb-2">Pick your team</legend>
                {invite.teams.map((t) => (
                  <label
                    key={t.id}
                    className={`flex min-h-12 items-center gap-3 rounded-ctl border px-3.5 py-2 ${
                      t.claimed ? "border-line text-muted" : chosen === t.id ? "border-accent bg-chip" : "cursor-pointer border-line bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name="team"
                      value={t.id}
                      disabled={t.claimed}
                      checked={chosen === t.id}
                      onChange={() => setChosen(t.id)}
                      className="h-5 w-5 accent-[#F2B84B]"
                    />
                    <span className="w-7 font-display text-lg font-extrabold">{t.draftNumber}</span>
                    <span className="flex-grow">{t.name}</span>
                    <span className="text-sm">{t.claimed ? `Taken by ${t.managerName ?? "someone"}` : "Open"}</span>
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1 text-sm text-muted">
                Team name
                <input
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  maxLength={40}
                  placeholder={chosen ? invite.teams.find((t) => t.id === chosen)?.name : "Pick a team first"}
                  className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
                />
                <span className="text-xs">You can change it in the lobby until the draft starts. The commissioner sets the draft order.</span>
              </label>
              {error && <PageError message={error} />}
              <button
                type="button"
                disabled={!chosen || busy}
                onClick={() => void claim()}
                className="h-14 rounded-panel bg-accent text-lg font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40"
              >
                {busy ? "Claiming…" : "Claim this team"}
              </button>
            </>
          )}
        </>
      )}
    </AppPage>
  );
}

export function JoinRoute() {
  const { code } = useParams<{ code: string }>();
  return <RequireSession>{code && <Join code={code.toUpperCase()} />}</RequireSession>;
}
