"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Una opción que se prende o se apaga: título y ayuda a la izquierda, el
 * interruptor a la derecha. Toda la fila es clickeable. Es un checkbox con
 * `role="switch"`, así que se opera igual con teclado y lector de pantalla.
 */
export function FilaInterruptor({
  titulo,
  ayuda,
  checked,
  onChange,
  tutorial,
  className,
}: Readonly<{
  titulo: string;
  ayuda?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Valor de `data-tutorial` para que un recorrido pueda resaltar la fila. */
  tutorial?: string;
  className?: string;
}>) {
  const id = useId();
  return (
    <label
      data-tutorial={tutorial}
      className={cn("flex cursor-pointer items-center gap-3.5 rounded-md border border-line bg-page px-3.5 py-3", className)}
    >
      <span className="flex flex-1 flex-col gap-0.5">
        <span id={`${id}-titulo`} className="text-[14px] font-semibold text-ink">
          {titulo}
        </span>
        {ayuda && (
          <span id={`${id}-ayuda`} className="text-[13px] leading-[1.5] text-ink-secondary">
            {ayuda}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={`${id}-titulo`}
        aria-describedby={ayuda ? `${id}-ayuda` : undefined}
        className="relative h-7 w-12 flex-none cursor-pointer appearance-none rounded-full bg-line-strong transition-colors before:absolute before:top-[3px] before:left-[3px] before:size-[22px] before:rounded-full before:bg-card before:shadow-sm before:transition-[left] checked:bg-primary checked:before:left-[23px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-semantic-border-focus)]"
      />
    </label>
  );
}
