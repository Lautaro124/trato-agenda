"use client";

import { useEffect, useId, useRef, type ReactNode, type Ref } from "react";
import { usePreferenciasNavegacion } from "@/lib/navegacion";

function IconoPanel({ abrir }: Readonly<{ abrir: boolean }>) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
      <path d={abrir ? "m11 9-3 3 3 3" : "m8 9 3 3-3 3"} />
    </svg>
  );
}

function Cabecera({
  onContraer,
  etiqueta,
  ref,
}: Readonly<{ onContraer: () => void; etiqueta: string; ref?: Ref<HTMLButtonElement> }>) {
  return (
    <div className="-mt-1 -mr-1.5 flex flex-none items-center justify-between gap-2">
      <h2 className="font-display text-[15px] font-bold text-ink">Datos de la venta</h2>
      <button
        ref={ref}
        type="button"
        onClick={onContraer}
        aria-label={etiqueta}
        title={etiqueta}
        className="grid size-10 flex-none cursor-pointer place-items-center rounded-sm text-ink-secondary hover:bg-sunken"
      >
        <IconoPanel abrir={false} />
      </button>
    </div>
  );
}

/**
 * Los datos de la venta en la tercera columna de la bandeja, al costado de la
 * conversación. Se pliegan a un riel y la preferencia queda guardada. Su ancho
 * abierto lo da la grilla (`--panel`). Con una sola columna los muestra la
 * conversación, plegados.
 */
export function PanelLateralVenta({ children }: Readonly<{ children: ReactNode }>) {
  const [prefs, guardarPrefs] = usePreferenciasNavegacion();
  const idPanel = useId();
  const botonRiel = useRef<HTMLButtonElement>(null);
  const botonCerrar = useRef<HTMLButtonElement>(null);
  const moverFoco = useRef(false);

  const abierto = !prefs.panelVentaContraido;

  // Tras abrir o cerrar con el teclado, el foco pasa al botón que quedó a la vista.
  useEffect(() => {
    if (!moverFoco.current) return;
    moverFoco.current = false;
    (abierto ? botonCerrar : botonRiel).current?.focus();
  }, [abierto]);

  const cambiar = (abrir: boolean) => {
    moverFoco.current = true;
    guardarPrefs({ panelVentaContraido: !abrir });
  };

  if (abierto) {
    return (
      <aside
        id={idPanel}
        aria-label="Datos de la venta"
        data-tutorial="estado-trato"
        className="flex min-h-0 w-(--panel,300px) flex-none flex-col gap-3 overflow-hidden rounded-lg border border-line bg-card p-4"
      >
        <Cabecera ref={botonCerrar} onContraer={() => cambiar(false)} etiqueta="Contraer datos de la venta" />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    );
  }

  return (
    <div
      data-tutorial="estado-trato"
      className="flex w-12 flex-none flex-col items-center gap-3 rounded-lg border border-line bg-card py-2"
    >
      <button
        ref={botonRiel}
        type="button"
        onClick={() => cambiar(true)}
        aria-label="Mostrar datos de la venta"
        title="Mostrar datos de la venta"
        aria-expanded={false}
        className="grid size-9 cursor-pointer place-items-center rounded-sm bg-sunken text-ink hover:bg-line"
      >
        <IconoPanel abrir />
      </button>
      <span aria-hidden className="rotate-180 text-xs font-bold whitespace-nowrap text-ink-secondary [writing-mode:vertical-rl]">
        Datos de la venta
      </span>
    </div>
  );
}
