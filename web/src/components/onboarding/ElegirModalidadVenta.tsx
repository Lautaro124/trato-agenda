"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ETIQUETA_MODALIDAD, type ModalidadVenta } from "@/lib/modalidad-venta";

const ICONO_CAJA = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </svg>
);

const ICONO_PEDIDO = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 10h6M9 14h4" />
    <path d="m15 17 1.5 1.5L19 16" />
  </svg>
);

const OPCIONES: Array<{ id: ModalidadVenta; descripcion: string; ideal: string; icono: ReactNode }> = [
  {
    id: "stock",
    descripcion: "Vendés lo que ya tenés. El asistente dice precio y stock, reserva la mercadería y manda el link de pago.",
    ideal: "Tiendas · ropa · almacenes · regalería",
    icono: ICONO_CAJA,
  },
  {
    id: "pedido",
    descripcion:
      "Hacés o conseguís cada pedido. El asistente toma la solicitud con el detalle y te la pasa para que la cotices.",
    ideal: "Muebles a medida · tortas · imprenta · encargos",
    icono: ICONO_PEDIDO,
  },
];

const RECORRIDO_A_PEDIDO = [
  { titulo: "Solicitado", detalle: "El asistente anota qué quiere el cliente." },
  { titulo: "A cotizar", detalle: "Te llega el aviso con todo el detalle." },
  { titulo: "Cotizado", detalle: "Le pasás el precio por su chat." },
  { titulo: "Pagado", detalle: "Como cualquier venta." },
];

/**
 * "¿Cómo vendés tus productos?" (LAU-21): con stock o a pedido. Mismo formato
 * que `ElegirAsistente`. Lo usan el wizard de /contanos y la sección de /cuenta.
 */
export function ElegirModalidadVenta({
  valor,
  onCambio,
}: {
  valor: ModalidadVenta;
  onCambio: (valor: ModalidadVenta) => void;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label="¿Cómo vendés tus productos?" className="flex flex-col gap-3">
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
                <span className="font-display text-[17px] font-bold text-ink sm:text-[18px]">
                  {ETIQUETA_MODALIDAD[opcion.id]}
                </span>
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

      {valor === "pedido" && (
        <div className="mt-5 max-w-[640px] rounded-md border border-line bg-page px-4 py-4 sm:px-5">
          <p className="mb-3 text-[13px] font-semibold text-ink-secondary">Cómo sigue cada pedido</p>
          <ol className="grid gap-3 sm:grid-cols-4 sm:gap-2.5">
            {RECORRIDO_A_PEDIDO.map((etapa, i) => (
              <li key={etapa.titulo} className="flex items-start gap-2.5 sm:flex-col sm:gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-6 flex-none place-items-center rounded-full text-[12px] font-bold text-white",
                    i === RECORRIDO_A_PEDIDO.length - 1 ? "bg-accent" : "bg-primary",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-bold text-ink">{etapa.titulo}</span>
                  <span className="text-[12.5px] leading-[1.45] text-ink-secondary">{etapa.detalle}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12.5px] leading-[1.5] text-ink-secondary">
            No necesitás cargar stock: el asistente nunca le dice al cliente que algo está agotado.
          </p>
        </div>
      )}
    </div>
  );
}
