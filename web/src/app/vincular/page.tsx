"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ConnectedCard,
  ConnectingCard,
  ErrorCard,
  ExpiredCard,
} from "@/components/LinkStateCards";
import { QrCode } from "@/components/QrCode";
import { DemoStateSwitcher } from "@/components/DemoStateSwitcher";
import { SessionChip } from "@/components/SessionChip";
import { Button } from "@/components/ui/Button";
import { useRequireSession } from "@/lib/session";

export type LinkState = "active" | "connecting" | "connected" | "expired" | "error";

/** El código de vinculación dura un minuto, como dice el diseño. */
const TTL_SECONDS = 60;

/**
 * Placeholder: el número real va a salir de la vinculación de WhatsApp, que
 * todavía no tiene backend. No se deriva del usuario de Google.
 */
const TELEFONO_DEMO = "+54 9 11 5555-1234";

const STEPS = [
  <>Abrí WhatsApp en tu teléfono.</>,
  <>
    Entrá a <strong className="font-semibold">Dispositivos vinculados</strong> y tocá{" "}
    <strong className="font-semibold">Vincular un dispositivo</strong>.
  </>,
  <>Apuntá la cámara al código de la izquierda.</>,
];

function newToken() {
  return `trato-link:${crypto.randomUUID()}`;
}

export default function VincularPage() {
  const { user, status } = useRequireSession();
  const [state, setState] = useState<LinkState>("active");
  const [token, setToken] = useState(newToken);
  const [secondsLeft, setSecondsLeft] = useState(TTL_SECONDS);

  const regenerate = useCallback(() => {
    setToken(newToken());
    setSecondsLeft(TTL_SECONDS);
    setState("active");
  }, []);

  // Cuenta regresiva: sólo corre mientras el código está vigente.
  useEffect(() => {
    if (state !== "active") return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setState("expired");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  // Vinculación simulada: "conectando" resuelve solo a los 2,5 s.
  useEffect(() => {
    if (state !== "connecting") return;
    const id = setTimeout(() => setState("connected"), 2500);
    return () => clearTimeout(id);
  }, [state]);

  // Mientras la API no conteste quién es, no mostramos el QR: si no hay sesión,
  // useRequireSession ya está redirigiendo a /entrar.
  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  return (
    <main className="relative grid min-h-dvh place-items-center bg-page p-6">
      <div className="absolute top-6 right-6">
        <SessionChip user={user} />
      </div>

      {state === "active" && (
        <div className="flex w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-md md:flex-row">
          {/* Columna del código */}
          <div className="flex flex-col items-center justify-center gap-4 border-b border-line bg-sunken p-8 md:w-[44%] md:border-r md:border-b-0">
            <div className="rounded-md bg-white p-3 shadow-sm">
              <QrCode value={token} size={210} />
            </div>
            <div className="flex items-center gap-[7px] text-xs text-muted">
              <span className="size-2 rounded-full bg-accent" />
              Código activo · se renueva en {secondsLeft} s
            </div>
          </div>

          {/* Columna de instrucciones */}
          <div className="flex-1 p-8">
            <h1 className="mb-2 font-display text-2xl leading-[1.2] font-bold tracking-[-0.02em] text-ink">
              Vinculá tu WhatsApp
            </h1>
            <p className="mb-6 text-sm leading-[1.6] text-ink-secondary">
              Es el número desde el que vas a hablarle al bot.
            </p>

            <ol className="flex flex-col gap-4">
              {STEPS.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-subtle text-xs font-bold text-primary-hover">
                    {i + 1}
                  </span>
                  <span className="text-sm leading-[1.55] text-ink">{step}</span>
                </li>
              ))}
            </ol>

            <div className="my-6 h-px bg-line" />

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setState("connecting")}
              >
                Vincular con un código
              </Button>
              <Button variant="ghost" size="md">
                Ayuda
              </Button>
            </div>

            <p className="mt-6 text-[12.5px] leading-[1.6] text-muted">
              Trato Agenda solo lee los mensajes que le mandás al bot. No accede al
              resto de tus chats.
            </p>
          </div>
        </div>
      )}

      {state === "connecting" && <ConnectingCard token={token} />}
      {state === "connected" && (
        // Todavía no existe la pantalla de agenda: el botón reinicia la demo.
        <ConnectedCard phone={TELEFONO_DEMO} onContinue={regenerate} />
      )}
      {state === "expired" && (
        <ExpiredCard token={token} onRegenerate={regenerate} />
      )}
      {state === "error" && (
        <ErrorCard code="error: link_timeout · 3f9a" onRetry={regenerate} />
      )}

      <DemoStateSwitcher
        state={state}
        onChange={setState}
        onRegenerate={regenerate}
      />
    </main>
  );
}
