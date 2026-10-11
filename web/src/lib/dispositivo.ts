"use client";

import { useSyncExternalStore } from "react";

const PATRON_CELULAR = /Android|iPhone|iPad|iPod|Mobile/i;

/**
 * Si la página se abrió en un celular o tablet. Un iPad con iPadOS se anuncia
 * como Mac, así que también cuenta una "Mac" con pantalla táctil.
 */
export function esCelular(userAgent: string, puntosTactiles = 0): boolean {
  return PATRON_CELULAR.test(userAgent) || (/Macintosh/.test(userAgent) && puntosTactiles > 1);
}

// El user agent no cambia mientras la página está abierta: no hay nada que escuchar.
const sinSuscripcion = () => () => {};

/**
 * `null` en el servidor y durante la hidratación (ahí no hay `navigator`), y
 * después true/false. Con `useSyncExternalStore` y no un effect que haga
 * `setState`, que la regla de lint del proyecto no deja.
 */
export function useEsCelular(): boolean | null {
  return useSyncExternalStore(
    sinSuscripcion,
    () => esCelular(navigator.userAgent, navigator.maxTouchPoints),
    () => null,
  );
}
