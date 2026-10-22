"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { ETIQUETA_ETAPA, porcentaje, type Performance, type ProductoPerformance } from "@/lib/performance";
import { formatearMonto } from "@/lib/productos";

const ORDENES = [
  { valor: "vieron", etiqueta: "Más vistos" },
  { valor: "pidieron", etiqueta: "Más pedidos" },
  { valor: "pagaron", etiqueta: "Más pagados" },
] as const;
type Orden = (typeof ORDENES)[number]["valor"];

function ordenar(productos: ProductoPerformance[], orden: Orden): ProductoPerformance[] {
  return [...productos].sort((a, b) => b[orden] - a[orden] || b.cobradoCentavos - a.cobradoCentavos || a.nombre.localeCompare(b.nombre));
}

const CELDA = "px-3 py-2.5 text-right tabular-nums";

/**
 * Cada producto en el embudo: cuántos chats lo vieron, lo pidieron y lo
 * pagaron, y dónde se quedan los que no compraron. Es una tabla (muchas
 * medidas por fila); en el celular se desliza de costado dentro de su caja.
 */
export function TablaProductos({ performance }: { performance: Performance }) {
  const [orden, setOrden] = useState<Orden>("vieron");
  const productos = ordenar(performance.productos, orden);

  return (
    <section aria-labelledby="titulo-productos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="titulo-productos" className="font-display text-[17px] font-bold text-ink">
            Productos
          </h2>
          <p className="text-[13px] text-ink-secondary">Cuántos chats nuevos del período vieron, pidieron y pagaron cada uno.</p>
        </div>
        <div role="radiogroup" aria-label="Ordenar productos" className="flex w-fit gap-1 rounded-md border border-line bg-sunken p-1">
          {ORDENES.map((opcion) => (
            <label
              key={opcion.valor}
              className={cn(
                "cursor-pointer rounded-sm px-3 py-1.5 text-[13px] font-semibold",
                orden === opcion.valor ? "bg-card text-ink shadow-sm" : "text-ink-secondary",
              )}
            >
              <input
                type="radio"
                name="orden-productos"
                value={opcion.valor}
                checked={orden === opcion.valor}
                onChange={() => setOrden(opcion.valor)}
                className="sr-only"
              />
              {opcion.etiqueta}
            </label>
          ))}
        </div>
      </div>

      {productos.length === 0 ? (
        <p className="rounded-lg border border-line bg-card py-8 text-center text-sm text-muted">
          Ningún chat nuevo del período vio un producto todavía.
        </p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full min-w-[720px] text-[13.5px] text-ink">
            <caption className="sr-only">Rendimiento de cada producto en el período</caption>
            <thead className="border-b border-line text-[12px] text-ink-secondary">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Producto
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Lo vieron
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Lo pidieron
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Lo pagaron
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Vio → pidió
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Pidió → pagó
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                  Cobrado
                </th>
                <th scope="col" className="px-3 py-2.5 text-left font-semibold">
                  Se quedan en
                </th>
              </tr>
            </thead>
            <tbody>
              {productos.map((producto) => (
                <tr key={producto.productoId} className="border-b border-line last:border-b-0">
                  <th scope="row" className="max-w-[240px] px-3 py-2.5 text-left font-normal">
                    <span className="block truncate font-semibold">{producto.nombre}</span>
                    <span className="text-[12px] text-muted">
                      {producto.codigo}
                      {producto.aMedida && " · a medida"}
                    </span>
                  </th>
                  <td className={CELDA}>{producto.vieron.toLocaleString("es-AR")}</td>
                  <td className={CELDA}>{producto.pidieron.toLocaleString("es-AR")}</td>
                  <td className={CELDA}>{producto.pagaron.toLocaleString("es-AR")}</td>
                  <td className={cn(CELDA, producto.vioAPidio.valor === null && "text-muted")}>{porcentaje(producto.vioAPidio)}</td>
                  <td className={cn(CELDA, producto.pidioAPago.valor === null && "text-muted")}>{porcentaje(producto.pidioAPago)}</td>
                  <td className={CELDA}>{formatearMonto(producto.cobradoCentavos, performance.moneda)}</td>
                  <td className="px-3 py-2.5 text-ink-secondary">{producto.cortanEn ? ETIQUETA_ETAPA[producto.cortanEn] : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
