"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ElegirAsistente, type TipoAsistente } from "@/components/onboarding/ElegirAsistente";
import { FormularioMovil } from "@/components/onboarding/FormularioMovil";
import { FormularioVentas, type DatosVentas } from "@/components/onboarding/FormularioVentas";
import { WizardEscritorio } from "@/components/onboarding/WizardEscritorio";
import { SessionChip } from "@/components/SessionChip";
import { apiFetch } from "@/lib/api";
import { useRequireSession } from "@/lib/session";
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

export default function ContanosPage() {
  const router = useRouter();
  const { user, status, refrescar } = useRequireSession();
  const ob = useOnboarding();
  const [tipoAsistente, setTipoAsistente] = useState<TipoAsistente>("agenda");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finalizar(ventas?: DatosVentas) {
    setEnviando(true);
    setError(null);

    let res: Response;
    try {
      res = await apiFetch(ventas ? "/agents/generate-ventas" : "/agents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ventas ?? ob.payload()),
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

  const alerta = error && (
    <p role="alert" className="text-[12.5px] text-danger-text">
      {error}
    </p>
  );
  const elegir = (tipo: TipoAsistente) => {
    setTipoAsistente(tipo);
    setError(null);
  };

  if (tipoAsistente === "ventas") {
    // El formulario de ventas es corto: el mismo layout sirve en escritorio y en móvil.
    return (
      <main className="min-h-dvh bg-page">
        <div className="mx-auto flex max-w-[640px] flex-col gap-4 p-5 md:py-10">
          <div className="flex justify-end">
            <SessionChip user={user} />
          </div>
          <ElegirAsistente valor={tipoAsistente} onCambio={elegir} />
          <FormularioVentas enviando={enviando} onFinalizar={(datos) => void finalizar(datos)} />
          {alerta}
        </div>
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
        <div className="flex w-full max-w-[940px] flex-col gap-4">
          <div className="max-w-[520px]">
            <ElegirAsistente valor={tipoAsistente} onCambio={elegir} />
          </div>
          <WizardEscritorio ob={ob} enviando={enviando} onFinalizar={() => void finalizar()} />
        </div>
        <div className="absolute bottom-6">{alerta}</div>
      </div>

      {/* Móvil: las mismas preguntas apiladas en un solo scroll. */}
      <div className="md:hidden">
        <div className="px-5 pt-4">
          <ElegirAsistente valor={tipoAsistente} onCambio={elegir} />
        </div>
        <FormularioMovil ob={ob} enviando={enviando} onFinalizar={() => void finalizar()} />
        {error && <div className="px-5 pb-4">{alerta}</div>}
      </div>
    </main>
  );
}
