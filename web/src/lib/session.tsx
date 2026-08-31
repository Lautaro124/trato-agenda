"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/** Usuario simulado: el MVP no tiene backend ni OAuth real todavía. */
export type MockUser = {
  email: string;
  initials: string;
  /** Se completa recién cuando WhatsApp queda vinculado. */
  phone: string;
};

const MOCK_USER: MockUser = {
  email: "lautaro@gmail.com",
  initials: "LG",
  phone: "+54 9 11 5555-1234",
};

type SessionValue = {
  user: MockUser | null;
  signIn: () => void;
  signOut: () => void;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(null);

  const signIn = useCallback(() => setUser(MOCK_USER), []);
  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession necesita estar dentro de <SessionProvider>");
  return ctx;
}

export { MOCK_USER };
