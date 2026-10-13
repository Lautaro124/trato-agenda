"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import {
  ConnectedCard,
  ConnectingCard,
  ErrorCard,
  ExpiredCard,
} from "@/components/LinkStateCards";
import { TarjetaCodigo } from "@/components/TarjetaCodigo";
import { TarjetaQr } from "@/components/TarjetaQr";
import { Button } from "@/components/ui/Button";
import { useEsCelular } from "@/lib/dispositivo";
import { useRequireSession } from "@/lib/session";
import { textoDeError, useVinculacion } from "@/lib/vinculacion";

export type { LinkState } from "@/lib/vinculacion";

const ENDPOINTS = {
  iniciar: "/whatsapp/link/start",
  reintentar: "/whatsapp/link/start",
  stream: "/whatsapp/link/stream",
  codigo: "/whatsapp/link/codigo",
};

const PIE = "Trato solo lee los mensajes que le mandan al asistente. No accede al resto de tus chats.";

export default function VincularPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  // Arranca (o resume) la vinculación real y se suscribe al stream de eventos.
  // Si ya estaba vinculado, la API contesta "connected" de una.
  const { state, qr, phone, motivo, regenerar, pedirCodigo } = useVinculacion(ENDPOINTS, status === "authenticated");
  // En el celular no se puede escanear la propia pantalla: ahí arranca con el código.
  const esCelular = useEsCelular();
  const [elegido, setElegido] = useState<"qr" | "codigo" | null>(null);
  const metodo = elegido ?? (esCelular ? "codigo" : "qr");
  // Con código, "vencido" se muestra en la misma tarjeta, que conserva el número tipeado.
  const enCodigo = metodo === "codigo" && (state === "active" || state === "expired");

  // Mientras la API no conteste quién es, no mostramos el QR: si no hay sesión,
  // useRequireSession ya está redirigiendo a /entrar.
  if (status !== "authenticated" || !user || esCelular === null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {(state === "active" || enCodigo) && <AppHeader active="vinculacion" user={user} />}

      <main className="grid flex-1 place-items-center bg-page p-4 md:p-6">
        {enCodigo && (
          <TarjetaCodigo
            titulo="Vinculá tu WhatsApp"
            bajada="Vas a vincular el WhatsApp de este celular: es el número que va a atender a tus clientes."
            pie={PIE}
            vencido={state === "expired"}
            onPedir={pedirCodigo}
            onUsarQr={() => {
              setElegido("qr");
              regenerar();
            }}
          />
        )}
        {metodo === "qr" && state === "active" && (
          <TarjetaQr
            qr={qr}
            titulo="Vinculá tu WhatsApp"
            bajada="Es el número que va a atender a tus clientes."
            acciones={
              <Button variant="ghost" size="md">
                Ayuda
              </Button>
            }
            onUsarCodigo={() => setElegido("codigo")}
            pie={PIE}
          />
        )}

        {state === "connecting" && <ConnectingCard token={qr ?? ""} />}
        {state === "connected" && (
          <ConnectedCard phone={phone ?? ""} onContinue={() => router.push("/inicio")} />
        )}
        {metodo === "qr" && state === "expired" && <ExpiredCard token={qr ?? ""} onRegenerate={regenerar} />}
        {state === "error" && <ErrorCard code={textoDeError(motivo)} onRetry={regenerar} />}
      </main>
    </div>
  );
}
