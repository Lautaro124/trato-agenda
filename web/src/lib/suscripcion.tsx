"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch } from "./api";
import { useSession } from "./session";

/** Espejo de `SuscripcionPublica` en la API. Las fechas llegan como ISO. */
export type Suscripcion = {
  estado: "activa" | "prueba" | "por_vencer" | "vencida";
  diasRestantes: number;
  pruebaHasta: string;
  proximoCobroAt: string | null;
  monto: number;
  moneda: string;
};

type SuscripcionValue = {
  suscripcion: Suscripcion | null;
  /** Vuelve a preguntarle a la API; lo usa /plan al volver de Mercado Pago. */
  refrescar: () => Promise<Suscripcion | null>;
};

const SuscripcionContext = createContext<SuscripcionValue | null>(null);

/**
 * El aviso de prueba vive en tres pantallas y la vuelta de Mercado Pago tiene
 * que poder refrescarlo: un provider evita una request por navegación y deja
 * un único lugar donde el estado se actualiza.
 */
export function SuscripcionProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);

  const refrescar = useCallback(async () => {
    try {
      const res = await apiFetch("/suscripcion");
      if (!res.ok) return null;
      const datos = (await res.json()) as Suscripcion;
      setSuscripcion(datos);
      return datos;
    } catch {
      return null;
    }
  }, []);

  // Mismo patrón que SessionProvider: el estado se setea dentro del callback
  // de la promesa, nunca en el cuerpo del efecto.
  useEffect(() => {
    if (status !== "authenticated") return;
    const ctrl = new AbortController();

    apiFetch("/suscripcion", { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<Suscripcion>) : null))
      .then((datos) => datos && setSuscripcion(datos))
      // La API caída no tiene que romper la pantalla: se muestra sin aviso.
      .catch(() => {});

    return () => ctrl.abort();
  }, [status]);

  // Sin sesión no hay suscripción que mostrar: se deriva del status en vez de
  // limpiarse desde el efecto, que dispararía un render en cascada.
  const value = useMemo(
    () => ({ suscripcion: status === "authenticated" ? suscripcion : null, refrescar }),
    [status, suscripcion, refrescar],
  );

  return <SuscripcionContext.Provider value={value}>{children}</SuscripcionContext.Provider>;
}

export function useSuscripcion(): SuscripcionValue {
  const ctx = useContext(SuscripcionContext);
  if (!ctx) throw new Error("useSuscripcion necesita estar dentro de <SuscripcionProvider>");
  return ctx;
}

/** "$20.000", como se escribe en Argentina. */
export function formatearMonto(monto: number, moneda = "ARS"): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(monto);
}

/** "8 de octubre" — la fecha en que termina la prueba, sin el año. */
export function formatearFechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" }).format(new Date(iso));
}
