"use client";

import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import {
  ConnectedCard,
  ConnectingCard,
  ErrorCard,
  ExpiredCard,
} from "@/components/LinkStateCards";
import { TarjetaQr } from "@/components/TarjetaQr";
import { Button } from "@/components/ui/Button";
import { useRequireSession } from "@/lib/session";
import { textoDeError, useVinculacion } from "@/lib/vinculacion";

export type { LinkState } from "@/lib/vinculacion";

const ENDPOINTS = {
  iniciar: "/whatsapp/link/start",
  reintentar: "/whatsapp/link/start",
  stream: "/whatsapp/link/stream",
};

export default function VincularPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  // Arranca (o resume) la vinculación real y se suscribe al stream de eventos.
  // Si ya estaba vinculado, la API contesta "connected" de una.
  const { state, qr, phone, motivo, regenerar } = useVinculacion(ENDPOINTS, status === "authenticated");

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

      <main className="grid flex-1 place-items-center bg-page p-4 md:p-6">
        {state === "active" && (
          <TarjetaQr
            qr={qr}
            titulo="Vinculá tu WhatsApp"
            bajada="Es el número desde el que vas a hablarle al bot."
            acciones={
              <Button variant="ghost" size="md">
                Ayuda
              </Button>
            }
            pie="Trato Agenda solo lee los mensajes que le mandás al bot. No accede al resto de tus chats."
          />
        )}

        {state === "connecting" && <ConnectingCard token={qr ?? ""} />}
        {state === "connected" && (
          <ConnectedCard phone={phone ?? ""} onContinue={() => router.push("/inicio")} />
        )}
        {state === "expired" && <ExpiredCard token={qr ?? ""} onRegenerate={regenerar} />}
        {state === "error" && <ErrorCard code={textoDeError(motivo)} onRetry={regenerar} />}
      </main>
    </div>
  );
}
