"use client";

import type { ReactNode } from "react";
import type { TipoAsistente } from "@/app/contanos/useOnboarding";
import { cn } from "@/lib/cn";

const ICONO_AGENDA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="m9 15 2 2 4-4" />
  </svg>
);

export const ICONO_BOLSA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 8h14l-1.2 12H6.2L5 8z" />
    <path d="M9 8V7a3 3 0 0 1 6 0v1" />
  </svg>
);

const OPCIONES: Array<{ id: TipoAsistente; label: string; descripcion: string; ideal: string; icono: ReactNode }> = [
  {
    id: "agenda",
    label: "Agendar turnos",
    descripcion: "Tus clientes piden, mueven o cancelan turnos por WhatsApp y quedan en tu agenda.",
    ideal: "Consultorios · estética · profesionales · servicios",
    icono: ICONO_AGENDA,
  },
  {
    id: "ventas",
    label: "Vender productos",
    descripcion: "Responde precios y stock de tu catálogo, toma pedidos y manda el link de pago.",
    ideal: "Comercios · tiendas · emprendimientos",
    icono: ICONO_BOLSA,
  },
];

/**
 * Primer paso del wizard: qué va a hacer el asistente. Decide los pasos que
 * siguen. Una cuenta no cambia de tipo después (la API responde 409), y eso se
 * avisa acá, antes de elegir.
 */
export function ElegirAsistente({
  valor,
  onCambio,
}: {
  valor: TipoAsistente;
  onCambio: (valor: TipoAsistente) => void;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="¿Qué va a hacer tu asistente?" className="flex flex-col gap-3">
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
                <span className="font-display text-[17px] font-bold text-ink sm:text-[18px]">{opcion.label}</span>
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
      <p className="mt-4 text-[12.5px] leading-[1.55] text-ink-secondary">
        Todo se puede cambiar después, menos el tipo de asistente.
      </p>
    </div>
  );
}
