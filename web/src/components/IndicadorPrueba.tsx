"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { DIAS_PRUEBA, formatearFechaCorta, useSuscripcion, type Suscripcion } from "@/lib/suscripcion";

const RADIO = 20;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;

function textoDias(dias: number): string {
  return dias === 1 ? "1 día" : `${dias} días`;
}

function etiquetaDe(suscripcion: Suscripcion): string {
  return suscripcion.estado === "vencida"
    ? "Prueba vencida: el asistente dejó de responder. Activar plan"
    : `Te quedan ${textoDias(suscripcion.diasRestantes)} de prueba. Ver plan`;
}

/**
 * Los días de prueba en la barra lateral, arriba de la cuenta: tarjeta con
 * barra de progreso cuando está desplegada, anillo cuando está contraída.
 * Con el plan activo no muestra nada.
 */
export function IndicadorPrueba({ contraida, onNavegar }: Readonly<{ contraida: boolean; onNavegar?: () => void }>) {
  const { suscripcion } = useSuscripcion();
  if (!suscripcion || suscripcion.estado === "activa") return null;

  const { estado, diasRestantes: dias } = suscripcion;
  const etiqueta = etiquetaDe(suscripcion);

  if (contraida) {
    const restante = estado === "vencida" ? 0 : Math.max(0.03, Math.min(1, dias / DIAS_PRUEBA));
    return (
      <Link
        href="/plan"
        onClick={onNavegar}
        aria-label={etiqueta}
        title={etiqueta}
        className={cn(
          "relative mx-auto grid size-12 flex-none place-items-center rounded-full",
          estado === "vencida" ? "bg-danger-subtle" : estado === "por_vencer" ? "bg-warning-subtle" : "bg-card",
        )}
      >
        <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden className="absolute inset-0 -rotate-90">
          <circle cx="24" cy="24" r={RADIO} fill="none" strokeWidth="4" className="stroke-line" />
          <circle
            cx="24"
            cy="24"
            r={RADIO}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${CIRCUNFERENCIA * restante} ${CIRCUNFERENCIA}`}
            className={estado === "prueba" ? "stroke-accent" : estado === "por_vencer" ? "stroke-warning" : "stroke-danger"}
          />
        </svg>
        <span aria-hidden className="relative flex flex-col items-center leading-none">
          <span className={cn("font-display text-sm font-extrabold", estado === "vencida" ? "text-danger-text" : "text-ink")}>
            {estado === "vencida" ? "!" : dias}
          </span>
          <span className="mt-px text-[9px] font-bold text-ink-secondary">
            {estado === "vencida" ? "plan" : dias === 1 ? "día" : "días"}
          </span>
        </span>
      </Link>
    );
  }

  if (estado === "prueba") {
    return (
      <Link
        href="/plan"
        onClick={onNavegar}
        aria-label={etiqueta}
        className="flex flex-none flex-col gap-2.5 rounded-md border border-line bg-page p-3 hover:bg-sunken"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="rounded-full bg-accent-subtle px-2.5 py-[3px] text-[11.5px] font-bold text-success-text">Prueba gratis</span>
          <span className="text-[12.5px] font-bold text-link">Ver plan</span>
        </span>
        <span className="flex items-baseline gap-1.5">
          <strong className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-ink">{textoDias(dias)}</strong>
          <span className="text-[13px] text-ink-secondary">restantes</span>
        </span>
        <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.round(Math.min(1, dias / DIAS_PRUEBA) * 100)}%` }}
          />
        </span>
      </Link>
    );
  }

  const vencida = estado === "vencida";
  return (
    <div
      className={cn(
        "flex flex-none flex-col gap-2.5 rounded-md border p-3",
        vencida ? "border-danger-subtle bg-danger-subtle" : "border-warning-subtle bg-warning-subtle",
      )}
    >
      <span
        className={cn(
          "self-start rounded-full px-2.5 py-[3px] text-[11.5px] font-bold",
          vencida ? "bg-danger text-white" : "bg-warning text-warning-text",
        )}
      >
        {vencida ? "Prueba vencida" : `Quedan ${textoDias(dias)}`}
      </span>
      <span className="text-[13px] leading-[1.45] text-ink">
        {vencida
          ? "El asistente dejó de responder. Tus datos siguen acá."
          : `Tu prueba termina el ${formatearFechaCorta(suscripcion.pruebaHasta)}. Activá el plan para no perder el asistente.`}
      </span>
      <Link
        href="/plan"
        onClick={onNavegar}
        className="grid min-h-10 place-items-center rounded-md bg-primary text-[13.5px] font-bold text-primary-on hover:bg-primary-hover"
      >
        {vencida ? "Activar plan" : "Suscribirme"}
      </Link>
    </div>
  );
}

/** En el celular la barra es un cajón: el encabezado muestra los días en una pastilla. */
export function PastillaPrueba() {
  const { suscripcion } = useSuscripcion();
  if (!suscripcion || suscripcion.estado === "activa") return null;
  const { estado, diasRestantes: dias } = suscripcion;
  return (
    <Link
      href="/plan"
      aria-label={etiquetaDe(suscripcion)}
      className={cn(
        "inline-flex h-8 flex-none items-center gap-1.5 rounded-full px-2.5 text-[12px] font-bold whitespace-nowrap md:hidden",
        estado === "prueba" && "bg-accent-subtle text-success-text",
        estado === "por_vencer" && "bg-warning-subtle text-warning-text",
        estado === "vencida" && "bg-danger-subtle text-danger-text",
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", estado === "prueba" ? "bg-accent" : estado === "por_vencer" ? "bg-warning" : "bg-danger")} />
      {estado === "vencida" ? (
        "Vencida"
      ) : (
        <>
          {textoDias(dias)}
          <span className="hidden sm:inline"> de prueba</span>
        </>
      )}
    </Link>
  );
}
