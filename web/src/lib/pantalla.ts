"use client";

import { useCallback, useLayoutEffect, useState, useSyncExternalStore, type RefObject } from "react";

/** Si la ventana cumple la media query; en el servidor y al hidratar, false. */
export function useMediaQuery(consulta: string): boolean {
  const suscribir = useCallback(
    (avisar: () => void) => {
      const mq = window.matchMedia(consulta);
      mq.addEventListener("change", avisar);
      return () => mq.removeEventListener("change", avisar);
    },
    [consulta],
  );
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}

/**
 * Ancho en px de un elemento, al día con cada cambio de tamaño. Sirve cuando
 * la lógica depende del espacio disponible y no de la ventana (por ejemplo,
 * al lado de la barra lateral). Antes de medir, 0.
 */
export function useAnchoDe(ref: RefObject<HTMLElement | null>): number {
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setAncho(el.clientWidth);
    const observador = new ResizeObserver(([entrada]) => setAncho(entrada.contentRect.width));
    observador.observe(el);
    return () => observador.disconnect();
  }, [ref]);
  return ancho;
}
