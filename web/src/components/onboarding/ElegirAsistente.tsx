"use client";

import { cn } from "@/lib/cn";

export type TipoAsistente = "agenda" | "ventas";

const OPCIONES: Array<{ id: TipoAsistente; label: string; hint: string }> = [
  { id: "agenda", label: "Agendar turnos", hint: "Consultorios, servicios, reuniones" },
  { id: "ventas", label: "Vender productos", hint: "Comercios: precios, stock y cobro" },
];

/**
 * Qué va a hacer el asistente. Arranca en "Agendar turnos", así el wizard de
 * siempre queda igual para quien no vende; "Vender productos" cambia el resto
 * de la pantalla por el formulario de ventas. Una cuenta no cambia de tipo
 * después (la API responde 409).
 */
export function ElegirAsistente({
  valor,
  onCambio,
}: {
  valor: TipoAsistente;
  onCambio: (valor: TipoAsistente) => void;
}) {
  return (
    <div role="radiogroup" aria-label="¿Qué va a hacer tu asistente?" className="grid grid-cols-2 gap-2">
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
              "cursor-pointer rounded-md border px-4 py-3 text-left",
              activa ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
            )}
          >
            <span className={cn("block text-[14.5px] text-ink", activa && "font-semibold")}>{opcion.label}</span>
            <span className="block text-[12px] text-muted">{opcion.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
