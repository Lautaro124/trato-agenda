"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { WizardContanos } from "@/components/onboarding/WizardContanos";
import { SessionChip } from "@/components/SessionChip";
import { Wordmark } from "@/components/Wordmark";
import { apiFetch } from "@/lib/api";
import { useRequireSession, yaVinculoWhatsapp } from "@/lib/session";
import { useOnboarding } from "./useOnboarding";

/** Qué decirle al usuario según cómo falló POST /agents/generate(-ventas). */
function mensajeDeError(status: number): string {
  if (status === 400) return "Revisá los datos: hay algún campo que no es válido.";
  if (status === 409) return "Tu cuenta ya tiene un asistente de otro tipo: no se puede cambiar.";
  if (status === 401) return "Tu sesión venció. Volvé a entrar para crear tu asistente.";
  // La config del agente ya no depende de OpenRouter: un 502/504 acá es un
  // problema de infraestructura (DB, deploy), no un timeout de un modelo.
  if (status === 502 || status === 504) return "Tuvimos un problema para guardar tu asistente. Probá de nuevo.";
  return "No pudimos crear tu asistente. Probá de nuevo.";
}

/** Dónde está parado en el alta completa: cuenta, asistente (este paso) y WhatsApp. */
function EtapasDelAlta({ yaVinculado }: { yaVinculado: boolean }) {
  const hecha = (texto: string) => (
    <span className="flex items-center gap-1.5 font-semibold text-success-text">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
      {texto}
    </span>
  );
  const linea = <span aria-hidden className="h-px w-6 bg-line-strong" />;
  return (
    <p className="hidden items-center gap-2 text-[13px] text-ink-secondary lg:flex">
      {hecha("Cuenta")}
      {linea}
      <span className="font-bold text-ink" aria-current="step">
        Tu asistente
      </span>
      {linea}
      {yaVinculado ? hecha("WhatsApp") : <span>WhatsApp</span>}
    </p>
  );
}

export default function ContanosPage() {
  const router = useRouter();
  const { user, status, refrescar } = useRequireSession();
  const ob = useOnboarding();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finalizar() {
    setEnviando(true);
    setError(null);

    let res: Response;
    try {
      res = await apiFetch(ob.esVentas ? "/agents/generate-ventas" : "/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ob.esVentas ? ob.payloadVentas() : ob.payload()),
      });
    } catch {
      setError("No pudimos conectarnos. Revisá tu conexión y probá de nuevo.");
      setEnviando(false);
      return;
    }

    if (!res.ok) {
      setError(mensajeDeError(res.status));
      setEnviando(false);
      return;
    }

    // La sesión ya en memoria no sabe qué asistente eligió: la navegación depende de eso.
    await refrescar();
    // /listo avisa que arrancó el mes de prueba; de ahí se sigue a /vincular, o
    // a la agenda y los planes si la cuenta ya escaneó el QR al registrarse.
    router.push("/listo");
  }

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  const yaVinculado = yaVinculoWhatsapp(user);

  return (
    <main className="flex min-h-dvh flex-col bg-page">
      <header className="flex items-center justify-end gap-6 px-5 pt-4 md:justify-between md:px-10 md:py-4">
        <span className="hidden md:block">
          <Wordmark size={24} />
        </span>
        <div className="flex items-center gap-6">
          <EtapasDelAlta yaVinculado={yaVinculado} />
          <SessionChip user={user} />
        </div>
      </header>

      <div className="flex flex-1 flex-col md:items-center md:px-10 md:pt-2 md:pb-10">
        <WizardContanos
          ob={ob}
          enviando={enviando}
          yaVinculado={yaVinculado}
          error={error}
          onFinalizar={() => void finalizar()}
        />
      </div>
    </main>
  );
}
