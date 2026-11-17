"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { errorDeConexionMeta, type useMetaSignup } from "@/lib/metaSignup";

/**
 * Abre Embedded Signup de Meta y manda lo que vuelve a `endpoint` para que la
 * API lo verifique: lo usan /vincular (conectar la cuenta) y /entrar (crear
 * la cuenta o entrar con WhatsApp Business).
 */
export function BotonWhatsappBusiness({
  signup,
  endpoint,
  texto,
  onListo,
}: {
  signup: ReturnType<typeof useMetaSignup>;
  endpoint: string;
  texto: string;
  /** Con la respuesta OK de la API. */
  onListo: (res: Response) => void | Promise<void>;
}) {
  const [pendiente, setPendiente] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function conectar() {
    setError(null);
    setPendiente(true);
    try {
      const resultado = await signup.conectar();
      if (!resultado.ok) {
        setError(resultado.error);
        return;
      }
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resultado.datos),
      });
      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => null)) as { motivo?: string } | null;
        setError(errorDeConexionMeta(res.status, cuerpo?.motivo));
        return;
      }
      await onListo(res);
    } catch {
      setError("No pudimos conectar con Trato. Probá de nuevo.");
    } finally {
      setPendiente(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="lg" fullWidth disabled={pendiente || !signup.disponible} onClick={() => void conectar()}>
        {pendiente ? "Conectando…" : texto}
      </Button>
      {error && (
        <p role="alert" className="text-[13px] leading-[1.5] text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
