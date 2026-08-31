"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { API_URL, apiFetch } from "./api";

/** Espejo de `UsuarioPublico` en la API: nunca incluye el refresh token de Google. */
export type Usuario = {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
};

/**
 * "loading" es un estado real, no un detalle: sin él los guards mandarían a
 * /entrar en el primer render, antes de que `/auth/me` conteste.
 */
export type SessionStatus = "loading" | "authenticated" | "anonymous";

type SessionValue = {
  user: Usuario | null;
  status: SessionStatus;
  signIn: () => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<Usuario | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  // La sesión vive en la cookie, no en React: hay que preguntarle a la API
  // en cada carga de página quién está del otro lado.
  useEffect(() => {
    const ctrl = new AbortController();

    apiFetch("/auth/me", { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) {
          // 401 es lo normal cuando no hay cookie: no es un error a reportar.
          setUser(null);
          setStatus("anonymous");
          return;
        }
        setUser((await res.json()) as Usuario);
        setStatus("authenticated");
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        // La API caída se trata igual que no tener sesión.
        setUser(null);
        setStatus("anonymous");
      });

    return () => ctrl.abort();
  }, []);

  /** Navegación completa del browser: el consentimiento de Google es cross-origin. */
  const signIn = useCallback(() => {
    // API_URL apunta a otro origen (la API), no a una ruta de Next: router.push
    // no puede salir del origen del front, así que la regla no aplica acá.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `${API_URL}/auth/google`;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setStatus("anonymous");
      router.replace("/entrar");
    }
  }, [router]);

  const value = useMemo(
    () => ({ user, status, signIn, signOut }),
    [user, status, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession necesita estar dentro de <SessionProvider>");
  return ctx;
}

/** Igual que useSession, pero patea a /entrar si no hay sesión. */
export function useRequireSession(): SessionValue {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === "anonymous") router.replace("/entrar");
  }, [session.status, router]);

  return session;
}

/** Iniciales para el avatar cuando Google no manda foto. */
export function iniciales(user: Usuario): string {
  const partes = (user.name ?? user.email.split("@")[0])
    .split(/[\s._-]+/)
    .filter(Boolean);

  const letras = partes.slice(0, 2).map((p) => p[0]);
  return (letras.join("") || user.email[0]).toUpperCase();
}
