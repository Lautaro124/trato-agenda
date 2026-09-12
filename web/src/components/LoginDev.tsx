"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

const INPUT =
  "w-full box-border rounded-md border border-line bg-card px-3.5 py-[11px] font-body text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

function mensajeDeError(status: number): string {
  if (status === 401) return "Contraseña incorrecta.";
  if (status === 409) return "Ese email ya es de una cuenta de Google: usá otro.";
  if (status === 404) return "El login de desarrollo está apagado en la API.";
  return "No se pudo entrar.";
}

/**
 * Login con contraseña, sólo para desarrollo y E2E: saltea Google y usa un
 * calendario falso en la API. /entrar sólo lo monta fuera de producción, y
 * además se esconde solo si la API no tiene DEV_LOGIN_PASSWORD.
 */
export function LoginDev() {
  const [habilitado, setHabilitado] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch("/auth/dev", { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ habilitado: boolean }>) : null))
      .then((estado) => setHabilitado(Boolean(estado?.habilitado)))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  async function entrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setError(null);

    try {
      const res = await apiFetch("/auth/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ...(email.trim() ? { email: email.trim() } : {}) }),
      });
      if (!res.ok) {
        setError(mensajeDeError(res.status));
        setEnviando(false);
        return;
      }
      const { destino } = (await res.json()) as { destino: string };
      // Navegación completa a propósito: SessionProvider sólo pregunta /auth/me
      // al montar, y con router.push seguiría creyendo que no hay sesión.
      window.location.href = destino;
    } catch {
      setError("No se pudo conectar con la API.");
      setEnviando(false);
    }
  }

  if (!habilitado) return null;

  return (
    <form
      onSubmit={(e) => void entrar(e)}
      aria-label="Entrar con contraseña"
      className="mt-6 flex flex-col gap-2.5 rounded-md border border-dashed border-line-strong p-4"
    >
      <p className="text-[12.5px] font-semibold text-ink-secondary">Entrar con contraseña (sólo dev)</p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="dev@trato.local"
        aria-label="Email de desarrollo"
        autoComplete="off"
        className={INPUT}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Contraseña"
        aria-label="Contraseña de desarrollo"
        required
        className={INPUT}
      />
      {error && (
        <p role="alert" className="text-[12.5px] text-danger-text">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" size="md" fullWidth disabled={enviando || !password}>
        {enviando ? "Entrando…" : "Entrar sin Google"}
      </Button>
    </form>
  );
}
