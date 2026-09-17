"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { Button } from "@/components/ui/Button";
import { API_URL, apiFetch } from "@/lib/api";
import { EMAIL_SOPORTE } from "@/lib/contacto";
import { PASSWORD_MIN, problemaDePassword } from "@/lib/password";
import { telefonoVisible, useRequireSession, type Usuario } from "@/lib/session";

/** Lo que hay que tipear para habilitar el borrado. Es irreversible. */
const CONFIRMACION = "ELIMINAR";

/** Lo que la API deja en `?google=` al volver de conectar Google Calendar. */
const AVISOS_GOOGLE: Record<string, { texto: string; tono: "ok" | "error" }> = {
  conectado: { texto: "Listo: tu agenda ahora vive en Google Calendar.", tono: "ok" },
  google_en_uso: {
    texto: "Esa cuenta de Google ya es de otro usuario de Trato Agenda. Probá con otra.",
    tono: "error",
  },
  migracion_incompleta: {
    texto:
      "Conectamos Google, pero no pudimos copiar todos tus turnos. Tu agenda sigue en Trato Agenda: probá conectar de nuevo en un rato.",
    tono: "error",
  },
};

/** "Cuenta de x@y.com · WhatsApp +549…. Tu agenda está en …" */
function describirCuenta(user: Usuario): string {
  const partes = [user.email, user.phoneNumber ? `WhatsApp ${telefonoVisible(user.phoneNumber)}` : null].filter(
    Boolean,
  );
  const agenda =
    user.calendario === "google" ? "Tu agenda está en Google Calendar." : "Tu agenda está en Trato Agenda.";
  return partes.length > 0 ? `Cuenta de ${partes.join(" · ")}. ${agenda}` : agenda;
}

export default function CuentaPage() {
  // useSearchParams necesita un límite de Suspense para prerenderizar la ruta.
  return (
    <Suspense fallback={<Cargando />}>
      <CuentaContenido />
    </Suspense>
  );
}

function Cargando() {
  return (
    <main className="grid min-h-dvh place-items-center bg-page p-6">
      <p className="text-sm text-muted">Cargando…</p>
    </main>
  );
}

function CuentaContenido() {
  const { user, status } = useRequireSession();
  const aviso = AVISOS_GOOGLE[useSearchParams().get("google") ?? ""];
  const [confirmacion, setConfirmacion] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "authenticated" || !user) {
    return <Cargando />;
  }

  const conGoogle = user.calendario === "google";

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
            <p className="text-sm leading-[1.6] text-ink-secondary">{describirCuenta(user)}</p>
          </div>

          {aviso && (
            <p
              role="status"
              className={
                aviso.tono === "ok"
                  ? "rounded-md bg-success-subtle p-3 text-[13.5px] text-success-text"
                  : "rounded-md bg-danger-subtle p-3 text-[13.5px] text-danger-text"
              }
            >
              {aviso.texto}
            </p>
          )}

          {!conGoogle && (
            <section className="rounded-lg border border-line bg-card p-5">
              <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Tu agenda</h2>
              <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
                Tus turnos y los horarios que bloqueás se guardan en Trato Agenda. Si usás Google
                Calendar, podés conectarlo: copiamos ahí los turnos que vienen y desde ese momento el
                asistente trabaja sobre tu Google Calendar, contando también lo que cargues a mano.
              </p>
              <div className="mt-4">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    // Navegación completa: el consentimiento de Google es cross-origin,
                    // y API_URL es otro origen, no una ruta de Next.
                    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                    window.location.href = `${API_URL}/auth/google/conectar`;
                  }}
                >
                  Conectar Google Calendar
                </Button>
              </div>
            </section>
          )}

          {conGoogle && (
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
          )}

          {user.phoneNumber && <SeccionContrasena tienePassword={user.tienePassword} />}

          <section className="rounded-lg border border-line bg-card p-5">
            <h2 className="mb-2 font-display text-[15px] font-bold text-danger-text">
              Eliminar mi cuenta
            </h2>
            <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
              Borra tu usuario, tu asistente, tus conversaciones, los mensajes, los turnos, tu agenda
              y tu suscripción, y desvincula tu WhatsApp
              {conGoogle ? " y revoca el acceso a tu Google Calendar" : ""}. Si tenés un cobro activo,
              lo cancelamos.
            </p>
            {conGoogle && (
              <p className="mt-2.5 text-[13.5px] leading-[1.6] text-ink-secondary">
                Los eventos que ya están en tu Google Calendar quedan ahí: son tuyos y no los tocamos.
              </p>
            )}
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

const INPUT_CUENTA =
  "w-full rounded-sm border border-line bg-page px-3 py-2 text-sm text-ink outline-none focus:border-primary";

/** Poner o cambiar la contraseña con la que se entra con el número de WhatsApp. */
function SeccionContrasena({ tienePassword }: { tienePassword: boolean }) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problema = problemaDePassword(nueva, confirmacion);
    if (problema) {
      setAviso({ texto: problema, ok: false });
      return;
    }
    setEnviando(true);
    setAviso(null);
    try {
      const res = await apiFetch("/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nueva, ...(tienePassword ? { actual } : {}) }),
      });
      if (res.status === 403) {
        setAviso({ texto: "La contraseña actual no es correcta.", ok: false });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      if (!tienePassword) {
        // La sesión cacheada todavía dice que no tiene: recargar para pedir la actual la próxima vez.
        window.location.reload();
        return;
      }
      setActual("");
      setNueva("");
      setConfirmacion("");
      setAviso({ texto: "Listo: tu contraseña quedó guardada.", ok: true });
    } catch {
      setAviso({ texto: "No pudimos guardar la contraseña. Probá de nuevo.", ok: false });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-card p-5">
      <h2 className="mb-2 font-display text-[15px] font-bold text-ink">Contraseña</h2>
      <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
        {tienePassword
          ? "Es la que usás para entrar con tu número de WhatsApp."
          : "Todavía no tenés una. Elegila para poder entrar con tu número de WhatsApp."}
      </p>
      <form onSubmit={(e) => void guardar(e)} aria-label="Cambiar contraseña" className="mt-4 flex flex-col gap-2.5">
        {tienePassword && (
          <input
            type="password"
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="Contraseña actual"
            aria-label="Contraseña actual"
            required
            className={INPUT_CUENTA}
          />
        )}
        <input
          type="password"
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder={`Nueva (al menos ${PASSWORD_MIN} caracteres)`}
          aria-label="Contraseña nueva"
          required
          className={INPUT_CUENTA}
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          placeholder="Repetila"
          aria-label="Repetir contraseña"
          required
          className={INPUT_CUENTA}
        />
        {aviso && (
          <p role="status" className={aviso.ok ? "text-[13px] text-success-text" : "text-[13px] text-danger-text"}>
            {aviso.texto}
          </p>
        )}
        <div>
          <Button type="submit" variant="secondary" size="md" disabled={enviando}>
            {enviando ? "Guardando…" : tienePassword ? "Cambiar contraseña" : "Guardar contraseña"}
          </Button>
        </div>
      </form>
    </section>
  );
}
