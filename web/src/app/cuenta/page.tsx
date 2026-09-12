"use client";

import Link from "next/link";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { EMAIL_SOPORTE } from "@/lib/contacto";
import { useRequireSession } from "@/lib/session";

/** Lo que hay que tipear para habilitar el borrado. Es irreversible. */
const CONFIRMACION = "ELIMINAR";

export default function CuentaPage() {
  const { user, status } = useRequireSession();
  const [confirmacion, setConfirmacion] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando…</p>
      </main>
    );
  }

  const eliminar = () => {
    setBorrando(true);
    setError(null);
    apiFetch("/auth/me", { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("no se pudo eliminar");
        // Navegación de documento completo, no router.push: SessionProvider vive
        // en el layout y no se vuelve a montar con una navegación de cliente, así
        // que seguiría exponiendo el usuario que acabamos de borrar.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/";
      })
      .catch(() => {
        setError("No pudimos eliminar la cuenta. Probá de nuevo en un rato.");
        setBorrando(false);
      });
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="cuenta" user={user} />

      <main className="flex-1 bg-page p-5 pb-24 md:pb-8">
        <div className="mx-auto flex w-full max-w-[620px] flex-col gap-5">
          <div>
            <h1 className="mb-1 font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
              Tu cuenta
            </h1>
            <p className="text-sm leading-[1.6] text-ink-secondary">
              Conectada con Google como {user.email}.
            </p>
          </div>

          <section className="rounded-lg border border-line bg-card p-5">
            <h2 className="mb-2 font-display text-[15px] font-bold text-ink">
              Permisos de Google
            </h2>
            <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
              Trato Agenda usa tu calendario para ver cuándo estás libre y para crear, mover y
              cancelar los turnos que acuerda tu asistente. No leemos los títulos ni los invitados de
              tus eventos para eso. Podés revocar el acceso cuando quieras desde{" "}
              <a
                href="https://myaccount.google.com/permissions"
                className="text-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                los permisos de tu cuenta de Google
              </a>
              ; si lo hacés, el asistente deja de poder operar tu agenda hasta que la vuelvas a
              conectar.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-[1.6] text-ink-secondary">
              El detalle completo está en la{" "}
              <Link href="/privacidad" className="text-link">
                política de privacidad
              </Link>
              .
            </p>
          </section>

          <section className="rounded-lg border border-line bg-card p-5">
            <h2 className="mb-2 font-display text-[15px] font-bold text-danger-text">
              Eliminar mi cuenta
            </h2>
            <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
              Borra tu usuario, tu asistente, tus conversaciones, los mensajes, los turnos y tu
              suscripción, y revoca el acceso a tu Google Calendar. Si tenés un cobro activo, lo
              cancelamos.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-[1.6] text-ink-secondary">
              Los eventos que ya están en tu Google Calendar quedan ahí: son tuyos y no los tocamos.
            </p>
            <p className="mt-2.5 text-[13.5px] leading-[1.6] font-semibold text-ink">
              No se puede deshacer.
            </p>

            <label
              htmlFor="confirmacion-borrado"
              className="mt-4 mb-1.5 block text-[12.5px] text-ink-secondary"
            >
              Escribí {CONFIRMACION} para habilitar el botón
            </label>
            <input
              id="confirmacion-borrado"
              type="text"
              value={confirmacion}
              onChange={(evento) => setConfirmacion(evento.target.value)}
              autoComplete="off"
              className="w-full rounded-sm border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary"
            />

            {error && <p className="mt-3 text-[13px] text-danger-text">{error}</p>}

            <div className="mt-4">
              <Button
                variant="danger"
                size="md"
                disabled={confirmacion.trim() !== CONFIRMACION || borrando}
                onClick={eliminar}
              >
                {borrando ? "Eliminando…" : "Eliminar mi cuenta y mis datos"}
              </Button>
            </div>

            <p className="mt-3 text-[12.5px] leading-[1.6] text-muted">
              ¿Dudas? Escribinos a{" "}
              <a href={`mailto:${EMAIL_SOPORTE}`} className="text-link">
                {EMAIL_SOPORTE}
              </a>{" "}
              antes de borrar nada.
            </p>
          </section>
        </div>
      </main>

      <MobileTabBar active="cuenta" />
    </div>
  );
}
