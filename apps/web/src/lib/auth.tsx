import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { mintDevSession } from "./api";

type Session = { token: string; userId: string };

const STORAGE_KEY = "draft-app:auth";

function readStored(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

type AuthContextValue = {
  session: Session | null;
  login: (displayName: string, email?: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readStored());

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: async (displayName, email) => {
        const next = await mintDevSession(displayName, email);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setSession(next);
      },
      logout: () => {
        localStorage.removeItem(STORAGE_KEY);
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
