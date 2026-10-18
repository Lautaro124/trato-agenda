"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/** Un paso de la ruta de migas: con `href` es un link, sin él es donde estás. */
export type Miga = { label: string; href?: string };

/**
 * La pantalla de alta/edición de un producto: migas, título, el formulario y
 * el pie fijo abajo con Cancelar / Guardar. Avisa si hay cambios sin guardar
 * al cancelar o al irse de la página. La usan el editor con stock y el de
 * productos a medida.
 */
export function PantallaProducto({
  titulo,
  migas,
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
  migas: Miga[];
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

  // Cerrar la pestaña o recargar con cambios: el navegador pregunta antes de perderlos.
  useEffect(() => {
    if (!hayCambios) return;
    const alSalir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [hayCambios]);

  const ancho_ = ancho ? "max-w-[1240px]" : "max-w-[1080px]";

  return (
    <main className="flex flex-1 flex-col bg-page">
      <form onSubmit={onGuardar} aria-labelledby={idTitulo} className="flex flex-1 flex-col">
        <div className={cn("mx-auto flex w-full flex-1 flex-col gap-5 px-4 pt-5 pb-8 sm:px-5", ancho_)}>
          <div className="flex flex-col gap-2">
            <nav aria-label="Ruta">
              <ol className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-muted">
                {migas.map((miga, indice) => (
                  <li key={`${miga.label}-${indice}`} className="flex items-center gap-1.5">
                    {indice > 0 && <span aria-hidden>/</span>}
                    {miga.href ? (
                      <Link href={miga.href} className="font-semibold text-[var(--color-semantic-text-link)] hover:underline">
                        {miga.label}
                      </Link>
                    ) : (
                      <span aria-current="page">{miga.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                id={idTitulo}
                className="font-display text-[27px] leading-[1.15] font-bold tracking-[-0.025em] text-ink"
              >
                {titulo}
              </h1>
              {junto}
            </div>
          </div>

          {children}
        </div>

        {/* Fijo abajo de la pantalla: guardar no obliga a bajar hasta el final.
            El error va acá también, para que se vea al lado del botón que lo produjo. */}
        <div className="sticky bottom-0 z-10 border-t border-line bg-card shadow-[0_-4px_12px_rgba(44,44,42,0.06)]">
          <div className={cn("mx-auto flex w-full flex-col gap-2 px-4 py-3 sm:px-5", ancho_)}>
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
              <Button variant="secondary" onClick={cerrar} className="flex-1 sm:flex-none">
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando} className="flex-[2] sm:flex-none">
                {guardando ? "Guardando…" : "Guardar producto"}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </main>
  );
}
