import type { ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

/** Sends anyone without a session to /login, remembering where they were headed. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

/** Frame for the pre-draft pages (home, setup, lobby, join): app name linking home, and a way to switch user. */
export function AppPage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <Link to="/" className="font-display text-lg font-bold uppercase">
          Draft Day
        </Link>
        {session && (
          <button type="button" onClick={logout} className="text-sm font-semibold text-muted hover:text-text">
            Sign out
          </button>
        )}
      </header>
      <main className={`mx-auto flex w-full flex-grow flex-col gap-4 px-4 py-5 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>{children}</main>
    </div>
  );
}

export function PageError({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-panel border border-warn-border bg-warn-bg px-4 py-3 text-sm font-semibold text-warn">
      {message}
    </div>
  );
}
