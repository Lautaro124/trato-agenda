"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { INPUT_FORM, PASSWORD_MIN, problemaDePassword } from "@/lib/password";
import { telefonoVisible, useRequireSession } from "@/lib/session";

/**
 * El paso que sigue al QR del alta: la contraseña con la que la cuenta de
 * WhatsApp vuelve a entrar. Quien ya tiene una no tiene nada que hacer acá.
 */
export default function ContrasenaPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.tienePassword) router.replace("/inicio");
  }, [user, router]);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problema = problemaDePassword(nueva, confirmacion);
    if (problema) {
      setError(problema);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const res = await apiFetch("/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nueva }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // Sigue el alta donde corresponda: el wizard si todavía no tiene asistente.
      const agente = await apiFetch("/agents/me");
      const cuerpo = agente.ok ? (await agente.text()).trim() : "";
      const tieneAgente = cuerpo !== "" && cuerpo !== "null";
      // Navegación completa: SessionProvider tiene que volver a leer tienePassword.
      window.location.href = tieneAgente ? "/inicio" : "/contanos";
    } catch {
      setError("No pudimos guardar la contraseña. Probá de nuevo.");
      setEnviando(false);
    }
  }

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando…</p>
      </main>
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-page p-5">
      <form
        onSubmit={(e) => void guardar(e)}
        aria-label="Elegir contraseña"
        className="flex w-full max-w-[380px] flex-col gap-3 rounded-lg border border-line bg-card p-6 shadow-md"
      >
        <div className="mb-3">
          <Wordmark size={24} />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-ink">Elegí tu contraseña</h1>
        <p className="text-sm leading-[1.6] text-ink-secondary">
          {user.phoneNumber ? (
            <>
              Tu WhatsApp <strong className="font-semibold">{telefonoVisible(user.phoneNumber)}</strong> ya quedó
              vinculado.{" "}
            </>
          ) : null}
          Con tu número y esta contraseña vas a entrar a Trato Agenda de ahora en más.
        </p>
        <input
          type="password"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder={`Al menos ${PASSWORD_MIN} caracteres`}
          aria-label="Contraseña nueva"
          required
          className={INPUT_FORM}
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          placeholder="Repetila"
          aria-label="Repetir contraseña"
          required
          className={INPUT_FORM}
        />
        {error && (
          <p role="alert" className="text-[13px] text-danger-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" fullWidth disabled={enviando || !nueva || !confirmacion}>
          {enviando ? "Guardando…" : "Guardar y seguir"}
        </Button>
      </form>
    </main>
  );
}
