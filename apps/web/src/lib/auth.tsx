import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { mintDevSession, UNAUTHORIZED_EVENT } from "./api";

export type Session = { token: string; userId: string };

const STORAGE_KEY = "draft-app:auth";

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function store(session: Session | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the session just lasts until the tab closes.
  }
}

type AuthContextValue = {
  session: Session | null;
  /** Keeps a session from POST /auth/verify (email code or link). */
  signIn: (session: Session) => void;
  /** The no-check dev login — only works when the server has DEV_LOGIN on. */
  devLogin: (displayName: string, email?: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readStored());

  // Any API call answered 401 (expired or signed-out session) drops the session, which sends the page to /login.
  useEffect(() => {
    const onUnauthorized = () => {
      store(null);
      setSession(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      signIn: (next) => {
        store(next);
        setSession(next);
      },
      devLogin: async (displayName, email) => {
        const next = await mintDevSession(displayName, email);
        store(next);
        setSession(next);
      },
      logout: () => {
        // Best effort: end it on the server too, but sign out here regardless.
        if (session) void fetch("/auth/logout", { method: "POST", headers: { authorization: `Bearer ${session.token}` } }).catch(() => {});
        store(null);
        setSession(null);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
