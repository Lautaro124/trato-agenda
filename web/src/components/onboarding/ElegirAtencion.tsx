"use client";

import type { ReactNode } from "react";
import { ETIQUETA_ATENCION, type Atencion } from "@/app/contanos/useOnboarding";
import { cn } from "@/lib/cn";

const ICONO_UNA_PERSONA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6" />
  </svg>
);

const ICONO_GRUPO = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="9" cy="8" r="3.2" />
    <circle cx="16.5" cy="9" r="2.6" />
    <path d="M3 20c.9-3.3 3.3-5 6-5s5.1 1.7 6 5" />
    <path d="M15 14.6c2.6-.4 4.9 1.1 5.8 4.4" />
  </svg>
);

const ICONO_AMBAS = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <circle cx="9" cy="15" r="1.6" />
    <circle cx="15" cy="15" r="1.6" />
  </svg>
);

const OPCIONES: Array<{ id: Atencion; descripcion: string; ideal: string; icono: ReactNode }> = [
  {
    id: "individual",
    descripcion: "Cada turno es para una persona: el asistente ofrece horarios libres de tu agenda.",
    ideal: "Consultorios · estética · profesionales · clases particulares",
    icono: ICONO_UNA_PERSONA,
  },
  {
    id: "grupal",
    descripcion: "Clases o talleres en horarios fijos: se anotan varias personas hasta llenar el cupo.",
    ideal: "Yoga · pilates · funcional · talleres",
    icono: ICONO_GRUPO,
  },
  {
    id: "ambas",
    descripcion: "Turnos individuales y también clases grupales, cada uno con sus reglas.",
    ideal: "Kinesiología con pilates · estudios con clases y sesiones",
    icono: ICONO_AMBAS,
  },
];

/**
 * Paso "¿Cómo atendés?" del asistente de turnos: decide si después se cargan
 * turnos individuales, clases grupales o los dos. Mismo formato que
 * `ElegirAsistente`, el primer paso.
 */
export function ElegirAtencion({ valor, onCambio }: { valor: Atencion; onCambio: (valor: Atencion) => void }) {
  return (
    <div role="radiogroup" aria-label="¿Cómo atendés a tus clientes?" className="flex flex-col gap-3">
      {OPCIONES.map((opcion) => {
        const activa = opcion.id === valor;
        return (
          <button
            key={opcion.id}
            type="button"
            role="radio"
            aria-checked={activa}
            onClick={() => onCambio(opcion.id)}
            className={cn(
              "flex cursor-pointer items-start gap-4 rounded-md border-2 p-4 text-left transition-colors sm:p-5",
              activa ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
            )}
          >
            <span className="grid size-11 flex-none place-items-center rounded-md border border-[var(--color-primitive-coral-200)] bg-card text-primary sm:size-12">
              {opcion.icono}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="font-display text-[17px] font-bold text-ink sm:text-[18px]">{ETIQUETA_ATENCION[opcion.id]}</span>
              <span className="text-[13.5px] leading-[1.55] text-ink-secondary sm:text-[14px]">{opcion.descripcion}</span>
              <span className="mt-0.5 text-[12.5px] text-ink-secondary">{opcion.ideal}</span>
            </span>
            <span
              aria-hidden
              className={cn(
                "grid size-[22px] flex-none place-items-center rounded-full border-2 bg-card",
                activa ? "border-primary" : "border-line",
              )}
            >
              {activa && <span className="size-2.5 rounded-full bg-primary" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
