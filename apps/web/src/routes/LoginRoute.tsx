import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Only same-app paths are followed after login, never an absolute URL someone put in ?next=. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Dev-only login: mints a session via POST /dev/session. Real magic-link auth is a later phase. */
export function LoginRoute() {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={next} replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Enter your name.");
      return;
    }
    setBusy(true);
    try {
      await login(displayName.trim(), email.trim() || undefined);
      navigate(next, { replace: true });
    } catch {
      setError("Could not start a session. Is the server running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-line bg-surface p-6">
        <h1 className="font-display text-2xl font-extrabold uppercase">Draft Day</h1>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Your name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Email (optional — use it again to get back to the same team)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
          />
        </label>
        {error && (
          <div role="alert" className="text-sm font-semibold text-warn">
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} className="h-12 rounded-ctl bg-accent text-base font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40">
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
