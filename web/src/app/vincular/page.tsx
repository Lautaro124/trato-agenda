"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  ConnectedCard,
  ConnectingCard,
  ErrorCard,
  ExpiredCard,
} from "@/components/LinkStateCards";
import { QrCode } from "@/components/QrCode";
import { Button } from "@/components/ui/Button";
import { apiFetch, sseUrl } from "@/lib/api";
import { useRequireSession } from "@/lib/session";

export type LinkState = "active" | "connecting" | "connected" | "expired" | "error";

type LinkEvent = {
  state: LinkState;
  qr?: string;
  phoneNumber?: string;
};

const STEPS = [
  <>Abrí WhatsApp en tu teléfono.</>,
  <>
    Entrá a <strong className="font-semibold">Dispositivos vinculados</strong> y tocá{" "}
    <strong className="font-semibold">Vincular un dispositivo</strong>.
  </>,
  <>Apuntá la cámara al código de la izquierda.</>,
];

export default function VincularPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const [state, setState] = useState<LinkState>("active");
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);

  const pedirLink = useCallback(
    () => apiFetch("/whatsapp/link/start", { method: "POST" }),
    [],
  );

  /** Para los botones "regenerar"/"reintentar": limpia lo que se ve y pide un QR nuevo. */
  const regenerate = useCallback(() => {
    setQr(null);
    setState("active");
    void pedirLink();
  }, [pedirLink]);

  // Arranca (o resume) la vinculación real y se suscribe al stream de eventos
  // que la API va empujando: QR nuevos, "conectando", "conectado", etc.
  useEffect(() => {
    if (status !== "authenticated") return;

    void pedirLink();
    const source = new EventSource(sseUrl("/whatsapp/link/stream"), {
      withCredentials: true,
    });
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as LinkEvent;
      setState(payload.state);
      if (payload.qr) setQr(payload.qr);
      if (payload.phoneNumber) setPhone(payload.phoneNumber);
    };

    return () => source.close();
  }, [status, pedirLink]);

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
    <div className="flex min-h-dvh flex-col">
      {state === "active" && <AppHeader active="vinculacion" user={user} />}

      <main className="grid flex-1 place-items-center bg-page p-6">
        {state === "active" && (
          <div className="flex w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-line bg-card shadow-md md:flex-row">
            {/* Columna del código */}
            <div className="flex flex-col items-center justify-center gap-4 border-b border-line bg-sunken p-8 md:w-[44%] md:border-r md:border-b-0">
              <div className="grid place-items-center rounded-md bg-white p-3 shadow-sm">
                {qr ? (
                  <QrCode value={qr} size={210} />
                ) : (
                  <div className="grid size-[210px] place-items-center">
                    <span className="text-xs text-muted">Generando código…</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-[7px] text-xs text-muted">
                <span className="size-2 rounded-full bg-accent" />
                Código activo · se renueva solo
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

        {state === "connecting" && <ConnectingCard token={qr ?? ""} />}
        {state === "connected" && (
          <ConnectedCard phone={phone ?? ""} onContinue={() => router.push("/inicio")} />
        )}
        {state === "expired" && (
          <ExpiredCard token={qr ?? ""} onRegenerate={regenerate} />
        )}
        {state === "error" && (
          <ErrorCard code="No pudimos vincular tu WhatsApp" onRetry={regenerate} />
        )}
      </main>
    </div>
  );
}
