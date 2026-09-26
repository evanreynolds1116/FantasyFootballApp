import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, type LeagueSummary } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppPage, PageError, RequireSession } from "./AppPage";

function statusLine(l: LeagueSummary): string {
  if (!l.draft) return `Setting up · ${l.claimedCount} of ${l.teamCount} teams claimed`;
  return l.draft.phase === "complete" ? "Draft complete" : "Draft is live";
}

function Home() {
  const token = useAuth().session!.token;
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    api<{ leagues: LeagueSummary[] }>(token, "GET", "/leagues")
      .then((r) => setLeagues(r.leagues))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your leagues."));
  }, [token]);

  return (
    <AppPage>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[26px] font-extrabold uppercase">Your leagues</h1>
        <Link to="/league/new" className="flex h-11 items-center rounded-ctl bg-accent px-4 text-[15px] font-bold text-on-accent">
          Create a league
        </Link>
      </div>

      {error && <PageError message={error} />}
      {leagues === null && !error && <div className="text-muted">Loading…</div>}
      {leagues?.length === 0 && (
        <div className="rounded-panel border border-dashed border-line-dashed p-5 text-muted">
          You&apos;re not in any leagues yet. Create one, or join with the invite code your commissioner sent.
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {leagues?.map((l) => (
          <li key={l.id}>
            <Link
              to={l.draft ? `/draft/${l.draft.id}` : `/league/${l.id}`}
              className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3.5 hover:border-accent"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[17px] font-semibold">{l.name}</span>
                <span className="text-sm text-muted">
                  {[l.isCommissioner ? "Commissioner" : null, l.myTeamName ? `Your team: ${l.myTeamName}` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={`flex-shrink-0 text-right text-sm font-semibold ${l.draft && l.draft.phase !== "complete" ? "text-accent" : "text-muted"}`}>
                {statusLine(l)}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) navigate(`/join/${code.trim().toUpperCase()}`);
        }}
        className="mt-2 flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
      >
        <label htmlFor="invite-code" className="label">
          Have an invite code?
        </label>
        <div className="flex gap-2">
          <input
            id="invite-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="K7Q2XMPA"
            autoCapitalize="characters"
            className="h-11 min-w-0 flex-grow rounded-ctl border border-line bg-surface-sunk px-3 font-semibold uppercase tracking-[0.1em] text-text outline-none focus:border-accent"
          />
          <button type="submit" className="h-11 rounded-ctl border border-line px-4 text-[15px] font-semibold">
            Join
          </button>
        </div>
      </form>
    </AppPage>
  );
}

export function HomeRoute() {
  return (
    <RequireSession>
      <Home />
    </RequireSession>
  );
}
