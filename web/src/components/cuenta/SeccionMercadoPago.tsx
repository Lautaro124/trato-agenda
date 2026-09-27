"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { API_URL, apiFetch } from "@/lib/api";

type EstadoMp = { disponible: boolean; conectada: boolean; mpUserId: string | null; conectadaAt: string | null };

/** Lo que la API deja en `?mp=` al volver de Mercado Pago. */
export const AVISOS_MP: Record<string, { texto: string; tono: "ok" | "error" }> = {
  conectado: { texto: "Listo: tu asistente ya cobra con links de Mercado Pago a tu nombre.", tono: "ok" },
  cancelado: { texto: "Cancelaste la conexión con Mercado Pago. Podés intentarlo cuando quieras.", tono: "error" },
  error: { texto: "No pudimos conectar Mercado Pago. Probá de nuevo en un rato.", tono: "error" },
};

/**
 * La cuenta de Mercado Pago del comercio: con ella el asistente manda links de
 * pago a nombre del negocio y la plata va directo a su cuenta. Sin conectarla,
 * los pedidos quedan anotados para cobrar a mano.
 */
export function SeccionMercadoPago() {
  const [estado, setEstado] = useState<EstadoMp | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/mercadopago/estado")
      .then((res) => (res.ok ? (res.json() as Promise<EstadoMp>) : null))
      .then(setEstado)
      .catch(() => setEstado(null));
  }, []);

  const desconectar = () => {
    if (!window.confirm("¿Desconectar Mercado Pago? El asistente deja de mandar links de pago.")) return;
    setTrabajando(true);
    setError(null);
    apiFetch("/mercadopago", { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error("no se pudo");
        setEstado((previo) => (previo ? { ...previo, conectada: false, mpUserId: null, conectadaAt: null } : previo));
      })
      .catch(() => setError("No pudimos desconectar Mercado Pago. Probá de nuevo."))
      .finally(() => setTrabajando(false));
  };

  return (
    <section aria-label="Mercado Pago" className="rounded-lg border border-line bg-card p-5">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-[15px] font-bold text-ink">Mercado Pago</h2>
        {estado && <Badge tone={estado.conectada ? "success" : "neutral"}>{estado.conectada ? "Conectado" : "Sin conectar"}</Badge>}
      </div>
      <p className="text-[13.5px] leading-[1.6] text-ink-secondary">
        {estado?.conectada
          ? "Cuando un cliente confirma una compra, tu asistente le manda un link de pago a tu nombre: la plata va directo a tu cuenta y la venta se registra sola cuando se acredita."
          : "Conectá tu cuenta para que el asistente mande links de pago a tu nombre. Mientras tanto, los pedidos quedan anotados y el cobro lo coordinás vos."}
      </p>
      {estado && !estado.disponible && !estado.conectada && (
        <p className="mt-2 text-[12.5px] text-muted">La conexión con Mercado Pago todavía no está habilitada.</p>
      )}
      <div className="mt-4 flex gap-2">
        {estado?.conectada ? (
          <Button variant="secondary" onClick={desconectar} disabled={trabajando}>
            {trabajando ? "Desconectando…" : "Desconectar"}
          </Button>
        ) : (
          <Button
            disabled={!estado?.disponible}
            onClick={() => {
              // Navegación completa: la autorización de Mercado Pago es otro origen,
              // y API_URL también, no una ruta de Next.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = `${API_URL}/mercadopago/conectar`;
            }}
          >
            Conectar Mercado Pago
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger-text">
          {error}
        </p>
      )}
    </section>
  );
}
