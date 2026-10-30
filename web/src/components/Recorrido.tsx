"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import type { Paso } from "@/lib/tutoriales";

/** Aire alrededor del elemento resaltado y separación de la burbuja. */
const MARGEN = 8;
const SEPARACION = 12;
const BORDE_PANTALLA = 12;
const ANCHO_BURBUJA = 360;

type Caja = { top: number; left: number; width: number; height: number };

/** El primer elemento con ese `data-tutorial` que se ve: escritorio y celular montan versiones distintas. */
function buscarObjetivo(objetivo: string): HTMLElement | null {
  const candidatos = document.querySelectorAll<HTMLElement>(`[data-tutorial="${objetivo}"]`);
  for (const el of candidatos) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * Si ya se ve una parte que alcanza, no se desplaza: un elemento más alto que
 * la pantalla (la agenda) correría la página y escondería el encabezado.
 */
function aLaVista(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const minimo = Math.min(r.height, 120);
  return r.top <= window.innerHeight - minimo && r.bottom >= minimo;
}

/** La caja del elemento con aire, recortada a la pantalla (un calendario puede ser más alto que ella). */
function medir(el: HTMLElement): Caja {
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - MARGEN, BORDE_PANTALLA / 2);
  const left = Math.max(r.left - MARGEN, BORDE_PANTALLA / 2);
  const bottom = Math.min(r.bottom + MARGEN, window.innerHeight - BORDE_PANTALLA / 2);
  const right = Math.min(r.right + MARGEN, window.innerWidth - BORDE_PANTALLA / 2);
  return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

/** Debajo si entra, si no arriba; si el elemento ocupa casi toda la pantalla, abajo de todo encima de él. */
function posicionBurbuja(caja: Caja | null, alto: number): React.CSSProperties {
  const ancho = Math.min(ANCHO_BURBUJA, window.innerWidth - BORDE_PANTALLA * 2);
  if (!caja) return { width: ancho, left: (window.innerWidth - ancho) / 2, top: Math.max((window.innerHeight - alto) / 2, BORDE_PANTALLA) };

  const centro = caja.left + caja.width / 2;
  const left = Math.min(Math.max(centro - ancho / 2, BORDE_PANTALLA), window.innerWidth - ancho - BORDE_PANTALLA);
  const abajo = caja.top + caja.height + SEPARACION;
  const arriba = caja.top - SEPARACION - alto;
  if (abajo + alto <= window.innerHeight - BORDE_PANTALLA) return { width: ancho, left, top: abajo };
  if (arriba >= BORDE_PANTALLA) return { width: ancho, left, top: arriba };
  return { width: ancho, left, bottom: `calc(${BORDE_PANTALLA}px + env(safe-area-inset-bottom))` };
}

/**
 * Recorrido paso a paso: oscurece la pantalla, deja a la vista el elemento de
 * cada paso y explica qué es en una burbuja. Los pasos cuyo elemento no se ve
 * (otra disposición en el celular, una sección vacía) se saltean al abrir.
 * Escape o «Saltar» lo cierran, igual que terminarlo.
 */
export function Recorrido({ pasos, onCerrar }: Readonly<{ pasos: Paso[]; onCerrar: () => void }>) {
  const [visibles] = useState(() => pasos.filter((p) => !p.objetivo || buscarObjetivo(p.objetivo)));
  const [indice, setIndice] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [altoBurbuja, setAltoBurbuja] = useState(0);
  const burbuja = useRef<HTMLDivElement>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const titulo = useId();
  const texto = useId();

  const paso = visibles[indice];
  const ultimo = indice === visibles.length - 1;

  useEffect(() => {
    if (visibles.length === 0) onCerrar();
  }, [visibles.length, onCerrar]);

  // El foco vuelve a donde estaba al cerrar.
  useEffect(() => {
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previo?.focus();
  }, []);

  const remedir = useCallback(() => {
    const el = paso?.objetivo ? buscarObjetivo(paso.objetivo) : null;
    setCaja(el ? medir(el) : null);
    if (burbuja.current) setAltoBurbuja(burbuja.current.offsetHeight);
  }, [paso]);

  useEffect(() => {
    const el = paso?.objetivo ? buscarObjetivo(paso.objetivo) : null;
    if (el && !aLaVista(el)) {
      const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "nearest", behavior: suave ? "smooth" : "auto" });
    }
    principal.current?.focus();
    // Se mide en el cuadro siguiente, con la burbuja del paso nuevo ya dibujada.
    const cuadro = requestAnimationFrame(remedir);
    return () => cancelAnimationFrame(cuadro);
  }, [paso, remedir]);

  // El scroll (también el de contenedores internos) y el tamaño de la ventana mueven el elemento.
  useEffect(() => {
    let cuadro = 0;
    const programar = () => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(remedir);
    };
    window.addEventListener("scroll", programar, { capture: true, passive: true });
    window.addEventListener("resize", programar);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener("scroll", programar, { capture: true });
      window.removeEventListener("resize", programar);
    };
  }, [remedir]);

  if (!paso) return null;

  const alTeclado = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCerrar();
      return;
    }
    if (e.key !== "Tab" || !burbuja.current) return;
    // El foco no sale de la burbuja mientras está abierta.
    const botones = burbuja.current.querySelectorAll<HTMLElement>("button");
    const primero = botones[0];
    const ultimoBoton = botones[botones.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimoBoton.focus();
    } else if (!e.shiftKey && document.activeElement === ultimoBoton) {
      e.preventDefault();
      primero.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50" onKeyDown={alTeclado}>
      {caja ? (
        // El hueco es una caja con una sombra enorme: oscurece todo menos el elemento.
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-md shadow-[0_0_0_9999px_rgba(26,25,23,0.55)] ring-2 ring-primary motion-safe:transition-all motion-safe:duration-200"
          style={caja}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-[rgba(26,25,23,0.55)]" />
      )}

      <div
        ref={burbuja}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo}
        aria-describedby={texto}
        className="fixed flex flex-col gap-3 rounded-lg border border-line bg-card p-5 shadow-lg"
        style={posicionBurbuja(caja, altoBurbuja)}
      >
        {visibles.length > 1 && (
          <p className="text-[12px] font-semibold text-muted">
            Paso {indice + 1} de {visibles.length}
          </p>
        )}
        <h2 id={titulo} className="font-display text-[17px] font-bold leading-[1.25] text-ink">
          {paso.titulo}
        </h2>
        <p id={texto} className="text-sm leading-[1.6] text-ink-secondary">
          {paso.texto}
        </p>
        <div className="mt-1 flex items-center gap-2">
          {!ultimo && (
            <Button variant="ghost" size="sm" onClick={onCerrar} className="-ml-3">
              Saltar
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {indice > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setIndice((i) => i - 1)}>
                Anterior
              </Button>
            )}
            <Button ref={principal} size="sm" onClick={() => (ultimo ? onCerrar() : setIndice((i) => i + 1))}>
              {ultimo ? "Listo" : "Siguiente"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
