"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormularioMovil } from "@/components/onboarding/FormularioMovil";
import { WizardEscritorio } from "@/components/onboarding/WizardEscritorio";
import { SessionChip } from "@/components/SessionChip";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
import { useOnboarding } from "./useOnboarding";

/** Qué decirle al usuario según cómo falló POST /agents/generate. */
function mensajeDeError(status: number): string {
  if (status === 400) return "Revisá los datos: hay algún campo que no es válido.";
  if (status === 401) return "Tu sesión venció. Volvé a entrar para crear tu asistente.";
  // La config del agente ya no depende de OpenRouter: un 502/504 acá es un
  // problema de infraestructura (DB, deploy), no un timeout de un modelo.
  if (status === 502 || status === 504) return "Tuvimos un problema para guardar tu asistente. Probá de nuevo.";
  return "No pudimos crear tu asistente. Probá de nuevo.";
}

export default function ContanosPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const ob = useOnboarding();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finalizar() {
    setEnviando(true);
    setError(null);

    let res: Response;
    try {
      res = await apiFetch("/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ob.payload()),
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

    // /listo avisa que arrancó el mes de prueba; de ahí se sigue a /vincular.
    router.push("/listo");
  }

  if (status !== "authenticated" || !user) {
    return (
      <main className="grid min-h-dvh place-items-center bg-page p-6">
        <p className="text-sm text-muted">Cargando tu sesión…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-page">
      {/* Escritorio: el wizard paso a paso. */}
      <div className="relative hidden min-h-dvh place-items-center p-7 md:grid">
        <div className="absolute top-6 right-6">
          <SessionChip user={user} />
        </div>
        <WizardEscritorio ob={ob} enviando={enviando} onFinalizar={finalizar} />
        <div className="absolute bottom-6">
          {error && (
            <p role="alert" className="text-[12.5px] text-danger-text">
              {error}
            </p>
          )}
        </div>
      </div>

      {/* Móvil: las mismas preguntas apiladas en un solo scroll. */}
      <div className="md:hidden">
        <FormularioMovil ob={ob} enviando={enviando} onFinalizar={finalizar} />
        {error && (
          <p role="alert" className="px-5 pb-4 text-[12.5px] text-danger-text">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
