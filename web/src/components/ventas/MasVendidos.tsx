"use client";

import { formatearCentavos } from "@/lib/productos";
import type { ResumenVentas } from "@/lib/ventas";

/**
 * Ranking de lo más vendido: barras horizontales de una sola serie (el mismo
 * coral), con el valor al final de cada barra en tinta, no en el color de la
 * serie. Es una lista corta, así que la barra acompaña y el número manda.
 */
export function MasVendidos({ productos }: { productos: ResumenVentas["topProductos"] }) {
  const maximo = Math.max(...productos.map((producto) => producto.cobradoCentavos), 1);

  return (
    <section aria-labelledby="titulo-mas-vendidos" className="rounded-lg border border-line bg-card p-5">
      <h2 id="titulo-mas-vendidos" className="mb-3 font-display text-[15px] font-bold text-ink">
        Lo más vendido
      </h2>
      {productos.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Sin ventas cobradas en este período.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {productos.map((producto) => (
            <li key={producto.codigo}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate text-ink">{producto.nombreProducto}</span>
                <span className="flex-none text-ink-secondary">
                  {producto.unidades} u. · <span className="font-semibold text-ink">{formatearCentavos(producto.cobradoCentavos)}</span>
                </span>
              </div>
              <div
                aria-hidden="true"
                className="h-3 rounded-r-[4px] bg-primary"
                style={{ width: `${Math.max((producto.cobradoCentavos / maximo) * 100, 1.5)}%` }}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
