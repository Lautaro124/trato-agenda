"use client";

import { useCallback, useEffect, useId, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * El diálogo de alta/edición de un producto: fondo, Escape, aviso de cambios
 * sin guardar y el pie fijo con Cancelar / Guardar. Lo usan el editor con
 * stock y el de productos a medida.
 */
export function DialogoProducto({
  titulo,
  junto,
  ancho = false,
  hayCambios,
  guardando,
  error,
  aviso,
  onCerrar,
  onGuardar,
  children,
}: Readonly<{
  titulo: string;
  /** Lo que va al lado del título sin ser parte de su nombre (una etiqueta, una ayuda). */
  junto?: ReactNode;
  /** El editor a medida, con su vista previa al costado, necesita más lugar. */
  ancho?: boolean;
  hayCambios: boolean;
  guardando: boolean;
  error: string | null;
  /** Lo que va a la izquierda del pie en vez de "Cambios sin guardar" (lo que falta, por ejemplo). */
  aviso?: ReactNode;
  onCerrar: () => void;
  onGuardar: (e: React.FormEvent) => void;
  children: ReactNode;
}>) {
  const idTitulo = useId();

  const cerrar = useCallback(() => {
    if (hayCambios && !window.confirm("Tenés cambios sin guardar. ¿Descartarlos?")) return;
    onCerrar();
  }, [hayCambios, onCerrar]);

  useEffect(() => {
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", alEscape);
    return () => document.removeEventListener("keydown", alEscape);
  }, [cerrar]);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        className={cn(
          "max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-t-lg bg-card p-5 shadow-md sm:rounded-lg",
          ancho ? "lg:max-w-[1160px]" : "lg:max-w-[980px]",
        )}
      >
        <form onSubmit={onGuardar} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={idTitulo} className="font-display text-[21px] font-bold text-ink">
              {titulo}
            </h2>
            {junto}
          </div>

          {children}

          {/* Fijo abajo del diálogo: guardar no obliga a bajar hasta el final.
              -bottom-5 lo pega al borde (el sticky se mide desde adentro del padding del diálogo).
              El error va acá también, para que se vea al lado del botón que lo produjo. */}
          <div className="sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-col gap-2 border-t border-line bg-card px-5 py-3">
            {error && (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {aviso ??
                (hayCambios && (
                  <p className="mr-auto basis-full text-[13px] font-semibold text-[var(--color-primitive-coral-700)] sm:basis-auto">
                    Cambios sin guardar
                  </p>
                ))}
              <Button variant="secondary" onClick={cerrar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar producto"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
