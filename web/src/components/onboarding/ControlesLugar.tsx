"use client";

import type { ReactNode } from "react";
import type { LocalState } from "@/app/contanos/useLocal";
import { cn } from "@/lib/cn";
import type { OpcionLugar } from "@/lib/local";
import { CamposDireccion } from "./ControlesLocal";

const ICONO_LOCAL = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 9.5 4.5 4h15L21 9.5" />
    <path d="M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5S21 10.9 21 9.5" />
    <path d="M5 12v9h14v-9M10 21v-5h4v5" />
  </svg>
);

const ICONO_CASA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 11 12 4l9 7" />
    <path d="M5 9.5V20h14V9.5" />
    <path d="M10 20v-6h4v6" />
  </svg>
);

const ICONO_SIN_LUGAR = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

const OPCIONES: Array<{ id: OpcionLugar; titulo: string; descripcion: string; icono: ReactNode }> = [
  {
    id: "local",
    titulo: "En un local o consultorio",
    descripcion: "El asistente le pasa la dirección a quien pregunte dónde es.",
    icono: ICONO_LOCAL,
  },
  {
    id: "casa",
    titulo: "En mi casa",
    descripcion: "Por tu privacidad, la dirección se la pasa sólo a quien ya tiene turno.",
    icono: ICONO_CASA,
  },
  {
    id: "ninguno",
    titulo: "No tengo un lugar fijo",
    descripcion: "Atendés online o vas a domicilio: el asistente no da ninguna dirección.",
    icono: ICONO_SIN_LUGAR,
  },
];

/**
 * Dónde da los turnos un asistente de agenda (LAU-17): el paso "¿Dónde
 * atendés?" de /contanos y la sección de /cuenta. Mismo formato de tarjetas
 * que `ElegirAtencion`, y debajo la dirección cuando hay un lugar fijo.
 */
export function ControlesLugar({ lugar }: Readonly<{ lugar: LocalState }>) {
  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="¿Dónde atendés a tus clientes?" className="flex flex-col gap-3">
        {OPCIONES.map((opcion) => {
          const activa = opcion.id === lugar.opcionLugar;
          return (
            <button
              key={opcion.id}
              type="button"
              role="radio"
              aria-checked={activa}
              onClick={() => lugar.elegirOpcionLugar(opcion.id)}
              className={cn(
                "flex cursor-pointer items-start gap-4 rounded-md border-2 p-4 text-left transition-colors",
                activa ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
              )}
            >
              <span className="grid size-11 flex-none place-items-center rounded-md border border-[var(--color-primitive-coral-200)] bg-card text-primary">
                {opcion.icono}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-display text-[16px] font-bold text-ink">{opcion.titulo}</span>
                <span className="text-[13.5px] leading-[1.55] text-ink-secondary">{opcion.descripcion}</span>
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

      {lugar.tieneLocal && (
        <CamposDireccion
          local={lugar}
          placeholder={lugar.opcionLugar === "casa" ? "Ej.: Güemes 4321, depto 3B, Palermo" : "Ej.: Av. Santa Fe 1234, piso 2, CABA"}
        />
      )}
    </div>
  );
}
