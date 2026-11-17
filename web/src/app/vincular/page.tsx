"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { AvisoRiesgoBloqueo } from "@/components/AvisoRiesgoBloqueo";
import {
  ConnectedCard,
  ConnectingCard,
  ErrorCard,
  ExpiredCard,
} from "@/components/LinkStateCards";
import { TarjetaCodigo } from "@/components/TarjetaCodigo";
import { TarjetaQr } from "@/components/TarjetaQr";
import { TarjetaMetaConectada, TarjetaWhatsappBusiness } from "@/components/TarjetaWhatsappBusiness";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useEsCelular } from "@/lib/dispositivo";
import { useMetaSignup } from "@/lib/metaSignup";
import { useRequireSession } from "@/lib/session";
import { textoDeError, useVinculacion, type WhatsappStatus } from "@/lib/vinculacion";

export type { LinkState } from "@/lib/vinculacion";

const ENDPOINTS = {
  iniciar: "/whatsapp/link/start",
  reintentar: "/whatsapp/link/start",
  stream: "/whatsapp/link/stream",
  codigo: "/whatsapp/link/codigo",
};

const SIN_ESTADO: WhatsappStatus = { linked: false, phoneNumber: null, canal: null, metaDisponible: false };

const PIE = "Trato solo lee los mensajes que le mandan al asistente. No accede al resto de tus chats.";

/**
 * Vincular por QR o código (Baileys, no oficial). Se monta sólo cuando hace
 * falta: al montarse arranca (o resume) la vinculación real y se suscribe al
 * stream de eventos; si ya estaba vinculado, la API contesta "connected".
 */
function VinculacionNoOficial({ onContinuar }: { onContinuar: () => void }) {
  const { state, qr, phone, motivo, regenerar, pedirCodigo } = useVinculacion(ENDPOINTS, true);
  // En el celular no se puede escanear la propia pantalla: ahí arranca con el código.
  const esCelular = useEsCelular();
  const [elegido, setElegido] = useState<"qr" | "codigo" | null>(null);
  const metodo = elegido ?? (esCelular ? "codigo" : "qr");
  // Con código, "vencido" se muestra en la misma tarjeta, que conserva el número tipeado.
  const enCodigo = metodo === "codigo" && (state === "active" || state === "expired");

  if (esCelular === null) return null;

  return (
    <>
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
      {state === "connected" && <ConnectedCard phone={phone ?? ""} onContinue={onContinuar} />}
      {metodo === "qr" && state === "expired" && <ExpiredCard token={qr ?? ""} onRegenerate={regenerar} />}
      {state === "error" && <ErrorCard code={textoDeError(motivo)} onRetry={regenerar} />}
    </>
  );
}

export default function VincularPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const signup = useMetaSignup();
  const [estado, setEstado] = useState<WhatsappStatus | null>(null);
  const [noOficialAbierta, setNoOficialAbierta] = useState(false);

  const recargar = useCallback(
    () =>
      apiFetch("/whatsapp/status")
        .then((res) => (res.ok ? (res.json() as Promise<WhatsappStatus>) : SIN_ESTADO))
        // Sin estado se ofrece igual todo: la API decide al conectar.
        .catch(() => SIN_ESTADO)
        .then(setEstado),
    [],
  );

  useEffect(() => {
    if (status !== "authenticated") return;
    let vigente = true;
    apiFetch("/whatsapp/status")
      .then((res) => (res.ok ? (res.json() as Promise<WhatsappStatus>) : SIN_ESTADO))
      .catch(() => SIN_ESTADO)
      .then((nuevo) => {
        if (vigente) setEstado(nuevo);
      });
    return () => {
      vigente = false;
    };
  }, [status]);

  // Mientras la API no conteste quién es, no mostramos nada: si no hay sesión,
  // useRequireSession ya está redirigiendo a /entrar.
  if (status !== "authenticated" || !user || estado === null || signup.disponible === undefined) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  const irAlInicio = () => router.push("/inicio");
  const metaDisponible = signup.disponible;
  const porQr = estado.canal === "baileys";
  // Sin la opción oficial (la API no tiene Meta configurado) queda el QR, como antes.
  const mostrarNoOficial = porQr || !metaDisponible || noOficialAbierta;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="vinculacion" user={user} />

      <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-page p-4 md:p-6">
        {estado.canal === "meta" ? (
          <TarjetaMetaConectada phone={estado.phoneNumber ?? ""} onContinuar={irAlInicio} onDesconectado={() => void recargar()} />
        ) : (
          <>
            {porQr && <AvisoRiesgoBloqueo className="w-full max-w-[560px]" />}
            {metaDisponible && (
              <TarjetaWhatsappBusiness signup={signup} migrando={porQr} onConectado={() => void recargar()} />
            )}
            {metaDisponible && !mostrarNoOficial && (
              <Button variant="ghost" size="md" onClick={() => setNoOficialAbierta(true)}>
                Vincular por QR o código (no oficial)
              </Button>
            )}
            {mostrarNoOficial && <VinculacionNoOficial onContinuar={irAlInicio} />}
          </>
        )}
      </main>
    </div>
  );
}
