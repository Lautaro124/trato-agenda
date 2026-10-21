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
  /** Plan contratado; null mientras no está pagando. */
  plan: PlanId | null;
  monto: number;
  moneda: string;
  /** Chats (clientes distintos) del mes en curso contra el tope del plan. */
  uso: { chats: number; limite: number };
  /** Lo que habilita el plan vigente: la regla vive en la API (`funcionesDelPlan`). */
  funciones?: { importacionRapida: boolean };
};

export type PlanId = "basico" | "pro";

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

export type PlanPublico = { id: PlanId; nombre: string; chats: number; monto: number };

/** Espejo de `PrecioPublico` en la API: los planes y sus precios, sin sesión. */
export type PrecioPlan = { moneda: string; planes: PlanPublico[] };

/**
 * Los precios de los planes tal como los fijan SUSCRIPCION_PRECIO_ARS (Básico)
 * y SUSCRIPCION_PRECIO_PRO_ARS en la API. Los usan la landing, que no tiene
 * sesión, y /plan; `null` mientras carga o si la API no responde, para no
 * mostrar nunca un número inventado.
 */
export function usePrecioPlan(): PrecioPlan | null {
  const [precio, setPrecio] = useState<PrecioPlan | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    apiFetch("/suscripcion/precio", { signal: ctrl.signal })
      .then((res) => (res.ok ? (res.json() as Promise<PrecioPlan>) : null))
      .then((datos) => datos && setPrecio(datos))
      .catch(() => {});

    return () => ctrl.abort();
  }, []);

  return precio;
}

/** "$20.000", como se escribe en Argentina. */
export function formatearMonto(monto: number, moneda = "ARS"): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(monto);
}

/** "1.500", como se escribe en Argentina. */
export function formatearChats(chats: number): string {
  return new Intl.NumberFormat("es-AR").format(chats);
}

/** "8 de octubre" — la fecha en que termina la prueba, sin el año. */
export function formatearFechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long" }).format(new Date(iso));
}
