"use client";

import { useSyncExternalStore } from "react";

/**
 * Preferencias de la barra lateral de este navegador: si está contraída y qué
 * grupos cerró la persona. Es comodidad por dispositivo, no un dato de la
 * cuenta: si el almacenamiento falla, vive en memoria hasta recargar.
 */
export type PreferenciasNavegacion = { contraida: boolean; gruposCerrados: readonly string[] };

const CLAVE = "trato:navegacion";
const POR_DEFECTO: PreferenciasNavegacion = { contraida: false, gruposCerrados: [] };

let actual: PreferenciasNavegacion | null = null;
const oyentes = new Set<() => void>();

function interpretar(raw: string | null): PreferenciasNavegacion {
  if (!raw) return POR_DEFECTO;
  try {
    const valor: unknown = JSON.parse(raw);
    if (typeof valor !== "object" || valor === null) return POR_DEFECTO;
    const { contraida, gruposCerrados } = valor as Record<string, unknown>;
    return {
      contraida: contraida === true,
      gruposCerrados: Array.isArray(gruposCerrados)
        ? gruposCerrados.filter((g): g is string => typeof g === "string").slice(0, 10)
        : [],
    };
  } catch {
    return POR_DEFECTO;
  }
}

function leerAlmacenamiento(): PreferenciasNavegacion {
  try {
    return interpretar(window.localStorage.getItem(CLAVE));
  } catch {
    return POR_DEFECTO;
  }
}

function leer(): PreferenciasNavegacion {
  actual ??= leerAlmacenamiento();
  return actual;
}

function avisar() {
  for (const oyente of oyentes) oyente();
}

// Otra pestaña cambió la preferencia: se adopta.
function alCambiarOtraPestana(e: StorageEvent) {
  if (e.key !== null && e.key !== CLAVE) return;
  actual = leerAlmacenamiento();
  avisar();
}

function suscribir(oyente: () => void) {
  if (oyentes.size === 0) window.addEventListener("storage", alCambiarOtraPestana);
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
    if (oyentes.size === 0) window.removeEventListener("storage", alCambiarOtraPestana);
  };
}

function guardar(cambio: Partial<PreferenciasNavegacion>) {
  actual = { ...leer(), ...cambio };
  try {
    window.localStorage.setItem(CLAVE, JSON.stringify(actual));
  } catch {
    // Sin almacenamiento (ventana privada, sitio bloqueado): queda en memoria.
  }
  avisar();
}

/** Desplegada por defecto; en el servidor y al hidratar, siempre el valor por defecto. */
export function usePreferenciasNavegacion(): [PreferenciasNavegacion, typeof guardar] {
  const prefs = useSyncExternalStore(suscribir, leer, () => POR_DEFECTO);
  return [prefs, guardar];
}
