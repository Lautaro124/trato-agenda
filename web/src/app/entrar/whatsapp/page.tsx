"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectingCard, ErrorCard, ExpiredCard } from "@/components/LinkStateCards";
import { TarjetaCodigo } from "@/components/TarjetaCodigo";
import { TarjetaQr } from "@/components/TarjetaQr";
import { Wordmark } from "@/components/Wordmark";
import { apiFetch } from "@/lib/api";
import { useEsCelular } from "@/lib/dispositivo";
import { useSession } from "@/lib/session";
import { textoDeError, useVinculacion } from "@/lib/vinculacion";

const ENDPOINTS = {
  iniciar: "/auth/whatsapp/alta",
  reintentar: "/auth/whatsapp/alta/reintentar",
  stream: "/auth/whatsapp/alta/stream",
  codigo: "/auth/whatsapp/alta/codigo",
};

const PIE = (
  <>
    Trato solo lee los mensajes que le mandan al asistente. Tus turnos quedan guardados en la agenda de Trato; si
    más adelante querés, los pasás a Google Calendar. Al seguir aceptás los{" "}
    <Link href="/terminos" className="text-link">
      términos
    </Link>{" "}
    y la{" "}
    <Link href="/privacidad" className="text-link">
      política de privacidad
    </Link>
    .
  </>
);

/**
 * Crear la cuenta sólo con WhatsApp: escanear el QR (o, desde el mismo
 * celular, ingresar el código de vinculación) es el registro. Si el número ya
 * tenía cuenta, la API entra a esa cuenta en vez de crear otra.
 */
export default function EntrarConWhatsappPage() {
  const router = useRouter();
  const { status } = useSession();
  const { state, qr, motivo, regenerar, pedirCodigo } = useVinculacion(ENDPOINTS, status === "anonymous");
  // En el celular no se puede escanear la propia pantalla: ahí arranca con el código.
  const esCelular = useEsCelular();
  const [elegido, setElegido] = useState<"qr" | "codigo" | null>(null);
  const metodo = elegido ?? (esCelular ? "codigo" : "qr");
  // Con código, "vencido" se muestra en la misma tarjeta, que conserva el número tipeado.
  const enCodigo = metodo === "codigo" && (state === "active" || state === "expired");
  const [falloAlEntrar, setFalloAlEntrar] = useState(false);

  // Con sesión viva no hay nada que crear.
  useEffect(() => {
    if (status === "authenticated") router.replace("/entrar");
  }, [status, router]);

  // Escaneado: la API cambia la cookie del alta por la de sesión.
  useEffect(() => {
    if (state !== "connected") return;
    apiFetch("/auth/whatsapp/alta/finalizar", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const { destino } = (await res.json()) as { destino: string };
        // Navegación completa: SessionProvider sólo pregunta /auth/me al montar.
        window.location.href = destino;
      })
      .catch(() => setFalloAlEntrar(true));
  }, [state]);

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="flex items-center justify-between px-5 py-4 md:px-8">
        <Link href="/entrar" aria-label="Volver a entrar">
          <Wordmark />
        </Link>
        <Link href="/entrar" className="text-[13.5px] text-link">
          Ya tengo cuenta
        </Link>
      </header>

      <main className="grid flex-1 place-items-center p-4 md:p-6">
        {falloAlEntrar ? (
          <ErrorCard code="No pudimos abrir tu cuenta" onRetry={() => window.location.reload()} />
        ) : esCelular === null ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : (
          <>
            {enCodigo && (
              <TarjetaCodigo
                titulo="Creá tu cuenta con WhatsApp"
                bajada="Vinculá el WhatsApp de tu negocio desde este celular. Ese número va a ser tu cuenta y el que atiende a tus clientes. Después elegís una contraseña para volver a entrar. No hace falta Google."
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
                titulo="Creá tu cuenta con WhatsApp"
                bajada="Escaneá el código con el WhatsApp de tu negocio. Ese número va a ser tu cuenta y el que atiende a tus clientes. Después elegís una contraseña para volver a entrar. No hace falta Google."
                onUsarCodigo={() => setElegido("codigo")}
                pie={PIE}
              />
            )}
            {(state === "connecting" || state === "connected") && <ConnectingCard token={qr ?? ""} />}
            {metodo === "qr" && state === "expired" && <ExpiredCard token={qr ?? ""} onRegenerate={regenerar} />}
            {state === "error" && (
              // Reintentar un alta es empezar otra: la cookie de la anterior puede haber vencido.
              <ErrorCard code={textoDeError(motivo)} onRetry={() => window.location.reload()} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
