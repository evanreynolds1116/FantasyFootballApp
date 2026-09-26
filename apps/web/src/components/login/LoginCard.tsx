import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "../../lib/api";

export const inputClass = "h-12 rounded-ctl border border-line bg-surface-sunk px-3 text-base text-text outline-none focus:border-accent";
export const primaryButton = "h-12 rounded-ctl bg-accent text-base font-bold uppercase tracking-[0.04em] text-on-accent disabled:opacity-40";

/** Only same-app paths are followed after sign-in, never an absolute URL someone put in ?next=. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function LoginCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-text">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-panel border border-line bg-surface p-6">
        <h1 className="font-display text-2xl font-extrabold uppercase">Draft Day</h1>
        {children}
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div role="alert" className="text-sm font-semibold text-warn">
      {message}
    </div>
  );
}

/** First sign-in only: the name everyone in the league will see. */
export function NameStep({ token, suggested, onDone }: { token: string; suggested: string; onDone: () => void }) {
  const [name, setName] = useState(suggested);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Enter your name.");
    setBusy(true);
    setError("");
    try {
      await api(token, "PATCH", "/me", { displayName: name.trim() });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save your name. Try again."));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-[15px]">You&apos;re signed in. What should the league call you?</p>
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" autoFocus className={inputClass} />
      </label>
      <FormError message={error} />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
