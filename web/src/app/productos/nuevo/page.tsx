"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MarcoDeProducto } from "@/components/productos/MarcoDeProducto";
import { cn } from "@/lib/cn";

/**
 * Qué se va a cargar. Una misma cuenta vende las dos cosas: lo de stock lo
 * reserva y cobra el asistente; lo a medida lo cotiza y te pasa el pedido.
 */
export default function NuevoProductoPage() {
  return (
    <MarcoDeProducto>
      <main className="flex-1 bg-page px-4 pt-6 pb-24 sm:px-5 md:pb-12">
        <div className="mx-auto flex max-w-[920px] flex-col">
          <nav aria-label="Ruta">
            <ol className="flex flex-wrap items-center gap-1.5 text-[13.5px] text-muted">
              <li>
                <Link href="/productos" className="font-semibold text-[var(--color-semantic-text-link)] hover:underline">
                  Productos
                </Link>
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden>/</span>
                <span aria-current="page">Nuevo</span>
              </li>
            </ol>
          </nav>
          <h1 className="mt-3 mb-1.5 font-display text-[30px] leading-[1.15] font-bold tracking-[-0.025em] text-ink">
            ¿Qué querés cargar?
          </h1>
          <p className="mb-7 max-w-[600px] text-[15px] leading-[1.6] text-ink-secondary">
            Tu asistente los vende distinto: lo de stock lo reserva y cobra al toque; lo a medida lo cotiza, pregunta los
            detalles y te pasa el pedido.
          </p>

          <ul className="grid gap-5 sm:grid-cols-2">
            <li className="flex">
              <Tipo
                href="/productos/nuevo/stock"
                titulo="De stock"
                texto="Ya lo tenés hecho. Precio fijo, talles o colores como variantes, y unidades que se descuentan cuando se paga."
                ejemplos={["Remeras", "Tazas", "Velas"]}
                accion="Cargar producto de stock"
                icono={ICONO_CAJA}
                tono="stock"
              />
            </li>
            <li className="flex">
              <Tipo
                href="/productos/nuevo/a-medida"
                titulo="A medida"
                texto="Lo hacés por encargo. El asistente pregunta medidas, colores o detalles, da un precio desde si lo cargás, y te pasa el pedido para cotizarlo."
                ejemplos={["Muebles", "Tortas", "Grabados"]}
                accion="Cargar producto a medida"
                icono={ICONO_REGLA}
                tono="medida"
              />
            </li>
          </ul>

          <p className="mt-7 text-sm text-muted">
            ¿Tenés muchos?{" "}
            <Link href="/productos?importar=1" className="font-semibold text-[var(--color-semantic-text-link)] hover:underline">
              Importalos desde una planilla
            </Link>{" "}
            — sirve sólo para productos de stock.
          </p>
        </div>
      </main>
    </MarcoDeProducto>
  );
}

function Tipo({
  href,
  titulo,
  texto,
  ejemplos,
  accion,
  icono,
  tono,
}: Readonly<{
  href: string;
  titulo: string;
  texto: string;
  ejemplos: string[];
  accion: string;
  icono: ReactNode;
  tono: "stock" | "medida";
}>) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex w-full flex-col gap-4 rounded-lg border-[1.5px] border-line bg-card p-6 text-ink shadow-sm sm:p-7",
        "transition-[border-color,box-shadow] duration-[120ms] hover:border-primary hover:shadow-lg",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
      )}
    >
      <span
        className={cn(
          "flex size-[52px] items-center justify-center rounded-md [&>svg]:size-[26px]",
          tono === "stock"
            ? "bg-primary-subtle text-primary"
            : "bg-[var(--color-semantic-info-subtle)] text-[var(--color-semantic-info-text)]",
        )}
      >
        {icono}
      </span>
      <span className="flex flex-col gap-1.5">
        <span className="font-display text-[22px] font-bold">{titulo}</span>
        <span className="text-[15px] leading-[1.5] text-ink-secondary">{texto}</span>
      </span>
      <span className="flex flex-wrap gap-1.5" aria-label="Por ejemplo">
        {ejemplos.map((ejemplo) => (
          <span key={ejemplo} className="rounded-full bg-sunken px-2.5 py-1 text-[12.5px] font-semibold text-ink-secondary">
            {ejemplo}
          </span>
        ))}
      </span>
      <span
        className={cn(
          "mt-auto inline-flex items-center gap-1.5 text-[15px] font-bold",
          tono === "stock" ? "text-[var(--color-semantic-text-link)]" : "text-[var(--color-semantic-info-text)]",
        )}
      >
        {accion}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}

const ICONO_CAJA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 8l-9-5-9 5 9 5 9-5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </svg>
);

const ICONO_REGLA = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 17l4 4 14-14-4-4L3 17z" />
    <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
  </svg>
);
