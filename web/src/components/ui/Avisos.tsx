"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

/**
 * Peligro: borra algo que no vuelve. Cuidado: cambia lo que hace el asistente.
 * Neutro: descarta un borrador; la acción segura (seguir) es la principal.
 */
type Tono = "peligro" | "cuidado" | "neutro";

export type Confirmacion = {
  titulo: string;
  texto?: string;
  /** Lo que hace el botón, no "Aceptar": "Sí, borrar", "Desconectar". */
  confirmar: string;
  cancelar?: string;
  tono?: Tono;
};

type TonoAviso = "exito" | "error" | "info";
type Aviso = { id: number; texto: string; tono: TonoAviso };

type Avisos = {
  /** Reemplaza a window.confirm: true si la persona confirmó. */
  confirmar: (pedido: Confirmacion) => Promise<boolean>;
  avisar: (texto: string, tono?: TonoAviso) => void;
};

const AvisosContext = createContext<Avisos | null>(null);

// Los errores quedan hasta que se cierran: si se van solos, se pierden.
const DURACION: Record<TonoAviso, number | null> = { exito: 5000, info: 4000, error: null };

const ICONO_TONO: Record<Tono, { fondo: string; trazo: ReactNode }> = {
  peligro: {
    fondo: "bg-danger-subtle text-danger-text",
    trazo: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
      </>
    ),
  },
  cuidado: {
    fondo: "bg-warning-subtle text-warning-text",
    trazo: (
      <>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      </>
    ),
  },
  neutro: {
    fondo: "bg-primary-subtle text-primary-hover",
    trazo: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
      </>
    ),
  },
};

const ICONO_AVISO: Record<TonoAviso, { color: string; trazo: ReactNode }> = {
  exito: { color: "text-[var(--color-primitive-green-200)]", trazo: <path d="M20 6L9 17l-5-5" /> },
  error: {
    color: "text-[var(--color-primitive-coral-200)]",
    trazo: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </>
    ),
  },
  info: {
    color: "text-[var(--color-primitive-blue-50)]",
    trazo: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
  },
};

/** Diálogos de confirmación y avisos de resultado con el sistema visual de Trato, en vez de los del navegador. */
export function AvisosProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [pedido, setPedido] = useState<Confirmacion | null>(null);
  const resolver = useRef<((confirmado: boolean) => void) | null>(null);
  const dialogo = useRef<HTMLDialogElement>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguienteId = useRef(0);

  const responder = useCallback((confirmado: boolean) => {
    resolver.current?.(confirmado);
    resolver.current = null;
    setPedido(null);
  }, []);

  const confirmar = useCallback((nuevo: Confirmacion) => {
    // Un pedido nuevo reemplaza al abierto: el anterior cuenta como cancelado.
    resolver.current?.(false);
    setPedido(nuevo);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const cerrarAviso = useCallback((id: number) => setAvisos((actual) => actual.filter((a) => a.id !== id)), []);

  const avisar = useCallback(
    (texto: string, tono: TonoAviso = "exito") => {
      const id = ++siguienteId.current;
      setAvisos((actual) => [...actual.slice(-2), { id, texto, tono }]);
      const duracion = DURACION[tono];
      if (duracion) setTimeout(() => cerrarAviso(id), duracion);
    },
    [cerrarAviso],
  );

  // showModal deja el resto de la página inerte y atrapa el foco; close lo devuelve a quien abrió.
  useEffect(() => {
    const el = dialogo.current;
    if (!el) return;
    if (pedido && !el.open) el.showModal();
    if (!pedido && el.open) el.close();
  }, [pedido]);

  // Escape se resuelve acá y no llega a los paneles de abajo (DetalleVenta cierra con Escape en document).
  useEffect(() => {
    if (!pedido) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      responder(false);
    };
    window.addEventListener("keydown", alTeclado, true);
    return () => window.removeEventListener("keydown", alTeclado, true);
  }, [pedido, responder]);

  const valor = useMemo(() => ({ confirmar, avisar }), [confirmar, avisar]);
  const tono = pedido?.tono ?? "peligro";

  return (
    <AvisosContext.Provider value={valor}>
      {children}
      <dialog
        ref={dialogo}
        role="alertdialog"
        aria-labelledby="confirmacion-titulo"
        aria-describedby={pedido?.texto ? "confirmacion-texto" : undefined}
        onClick={(e) => {
          if (e.target === e.currentTarget) responder(false);
        }}
        className={cn(
          "mt-auto mb-0 w-full max-w-none rounded-t-[20px] border-0 bg-card p-0 text-ink shadow-lg",
          "sm:m-auto sm:max-w-[440px] sm:rounded-lg",
          "backdrop:bg-[rgba(26,25,23,0.45)]",
          "open:animate-[trato-entrar_200ms_var(--motion-easing-out)] motion-reduce:animate-none",
        )}
      >
        {pedido && (
          <div className="flex flex-col gap-5 px-5 pt-3 pb-7 sm:p-7">
            <div aria-hidden className="h-1 w-10 self-center rounded-full bg-line sm:hidden" />
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
              <div
                aria-hidden
                className={cn("flex size-11 flex-none items-center justify-center rounded-full", ICONO_TONO[tono].fondo)}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {ICONO_TONO[tono].trazo}
                </svg>
              </div>
              <div className="flex flex-col gap-1.5">
                <h2 id="confirmacion-titulo" className="font-display text-[20px] leading-[1.25] font-bold text-ink">
                  {pedido.titulo}
                </h2>
                {pedido.texto && (
                  <p id="confirmacion-texto" className="text-[15px] leading-[1.5] text-ink-secondary">
                    {pedido.texto}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
              <Button
                autoFocus
                size="lg"
                variant={tono === "neutro" ? "primary" : "secondary"}
                className="sm:px-[18px] sm:py-2.5 sm:text-[15px]"
                onClick={() => responder(false)}
              >
                {pedido.cancelar ?? "Cancelar"}
              </Button>
              <Button
                size="lg"
                variant={tono === "peligro" ? "danger" : tono === "neutro" ? "ghost" : "primary"}
                className="sm:px-[18px] sm:py-2.5 sm:text-[15px]"
                onClick={() => responder(true)}
              >
                {pedido.confirmar}
              </Button>
            </div>
          </div>
        )}
      </dialog>

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex flex-col items-center gap-2 md:bottom-8"
      >
        {avisos.map((aviso) => (
          <div
            key={aviso.id}
            role={aviso.tono === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-md bg-ink py-2 pr-2 pl-[18px] text-white shadow-lg animate-[trato-entrar_200ms_var(--motion-easing-out)] motion-reduce:animate-none"
          >
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn("flex-none", ICONO_AVISO[aviso.tono].color)}
            >
              {ICONO_AVISO[aviso.tono].trazo}
            </svg>
            <span className="flex-1 py-1.5 text-[15px] leading-[1.4] font-medium">{aviso.texto}</span>
            <button
              type="button"
              aria-label="Cerrar aviso"
              onClick={() => cerrarAviso(aviso.id)}
              className="flex size-9 flex-none cursor-pointer items-center justify-center rounded-sm text-line-strong hover:bg-white/10"
            >
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </AvisosContext.Provider>
  );
}

export function useAvisos(): Avisos {
  const avisos = useContext(AvisosContext);
  if (!avisos) throw new Error("useAvisos necesita AvisosProvider");
  return avisos;
}
