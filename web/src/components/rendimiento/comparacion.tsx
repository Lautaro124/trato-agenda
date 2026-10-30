"use client";

import { cn } from "@/lib/cn";
import type { Variacion } from "@/lib/performance";

/**
 * Lo común a todos los gráficos que comparan dos períodos: el actual va en
 * coral y el anterior en un gris más claro, así se distinguen también por la
 * luz y no sólo por el color.
 */
export const COLOR_ACTUAL = "bg-primary";
export const COLOR_ANTERIOR = "bg-[var(--color-primitive-neutral-400)]";
/** El anterior a medias (el registro empezó en el medio): rayado. */
export const COLOR_ANTERIOR_A_MEDIAS =
  "bg-[repeating-linear-gradient(135deg,var(--color-primitive-neutral-400)_0_4px,var(--color-primitive-neutral-100)_4px_8px)]";
export const RELLENO_ACTUAL = "var(--color-semantic-primary-default)";
export const RELLENO_ANTERIOR = "var(--color-primitive-neutral-400)";

const TONO: Record<Variacion["tono"], string> = {
  sube: "bg-success-subtle text-success-text",
  baja: "bg-danger-subtle text-danger-text",
  igual: "bg-sunken text-ink-secondary",
  nuevo: "bg-[var(--color-semantic-info-subtle)] text-[var(--color-semantic-info-text)]",
};

/**
 * "▲ 6 pts", "Nuevo · antes 0" o "Sin comparación" si el anterior no tiene
 * datos. Con el anterior a medias, en ámbar: la variación se puede leer, pero
 * no es pareja.
 */
export function EtiquetaVariacion({ variacion, aMedias = false }: { variacion: Variacion | null; aMedias?: boolean }) {
  const base = "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[12.5px] font-bold whitespace-nowrap";
  if (!variacion) return <span className={cn(base, "bg-sunken font-semibold text-ink-secondary")}>Sin comparación</span>;
  return (
    <span className={cn(base, aMedias ? "bg-warning-subtle text-warning-text" : TONO[variacion.tono])}>
      <span aria-hidden="true">
        {variacion.texto}
        {aMedias && " · a medias"}
      </span>
      <span className="sr-only">
        {variacion.descripcion}
        {aMedias && ", con el período anterior medido a medias"}
      </span>
    </span>
  );
}

/** El cuadradito de la leyenda de cada período. */
export function Muestra({ anterior = false }: { anterior?: boolean }) {
  return <span aria-hidden="true" className={cn("inline-block size-3.5 shrink-0 rounded-[4px]", anterior ? COLOR_ANTERIOR : COLOR_ACTUAL)} />;
}
