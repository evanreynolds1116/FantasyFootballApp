import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Dev-only login: mints a session via POST /dev/session. Real magic-link auth is a later phase. */
export function LoginRoute() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [draftId, setDraftId] = useState(params.get("draftId") ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || !draftId.trim()) {
      setError("Enter your name and the draft ID.");
      return;
    }
    setBusy(true);
    try {
      await login(displayName.trim(), email.trim() || undefined);
      navigate(`/draft/${draftId.trim()}`);
    } catch {
      setError("Could not start a session. Is the server running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-line bg-surface p-6">
        <h1 className="font-display text-2xl font-extrabold uppercase">Join a draft</h1>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Your name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Email (optional — reuse it to return to the same team)
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Draft ID
          <input
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            className="h-11 rounded-ctl border border-line bg-surface-sunk px-3 text-text outline-none focus:border-accent"
          />
        </label>
        {error && (
          <div role="alert" className="text-sm font-semibold text-warn">
            {error}
          </div>
        )}
        <button type="submit" disabled={busy} className="h-12 rounded-ctl bg-accent text-base font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40">
          {busy ? "Joining…" : "Join"}
        </button>
      </form>
    </div>
  );
}
