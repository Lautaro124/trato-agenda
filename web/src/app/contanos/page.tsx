"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormularioMovil } from "@/components/onboarding/FormularioMovil";
import { WizardEscritorio } from "@/components/onboarding/WizardEscritorio";
import { SessionChip } from "@/components/SessionChip";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
import { useOnboarding } from "./useOnboarding";

export default function ContanosPage() {
  const router = useRouter();
  const { user, status } = useRequireSession();
  const ob = useOnboarding();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finalizar() {
    setEnviando(true);
    setError(null);

    const res = await apiFetch("/agents/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ob.payload()),
    });

    if (!res.ok) {
      setError("No pudimos crear tu asistente. Probá de nuevo.");
      setEnviando(false);
      return;
    }

    router.push("/vincular");
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
        {error && (
          <p className="absolute bottom-6 text-[12.5px] text-danger-text">{error}</p>
        )}
      </div>

      {/* Móvil: las mismas preguntas apiladas en un solo scroll. */}
      <div className="md:hidden">
        <FormularioMovil ob={ob} enviando={enviando} onFinalizar={finalizar} />
        {error && <p className="px-5 pb-4 text-[12.5px] text-danger-text">{error}</p>}
      </div>
    </main>
  );
}
