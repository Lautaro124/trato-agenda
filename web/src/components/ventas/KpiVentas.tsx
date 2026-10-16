"use client";

import { cn } from "@/lib/cn";
import { formatearCentavos } from "@/lib/productos";
import { pesosCompactos, type Totales } from "@/lib/ventas";

/** Montos de más de diez millones van compactos: la tarjeta es angosta. */
function monto(centavos: number): string {
  return centavos >= 1_000_000_000 ? pesosCompactos(centavos) : formatearCentavos(centavos);
}

function Tarjeta({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-[12.5px] text-ink-secondary">{etiqueta}</div>
      <div className="mt-1 font-display text-[20px] font-bold whitespace-nowrap text-ink tabular-nums sm:text-2xl">{valor}</div>
      {detalle && <div className="mt-0.5 text-[12px] text-muted">{detalle}</div>}
    </div>
  );
}

/** La fila de números del período: lo cobrado manda, el resto lo acompaña. */
export function KpiVentas({ totales, aPedido = false }: { totales: Totales; aPedido?: boolean }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", aPedido ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
      <Tarjeta etiqueta="Cobrado" valor={monto(totales.cobradoCentavos)} />
      <Tarjeta etiqueta="Ventas pagadas" valor={totales.pagadas.toLocaleString("es-AR")} />
      {/* Un promedio con centavos es precisión de más: va redondeado al peso. */}
      <Tarjeta
        etiqueta="Ticket promedio"
        valor={totales.pagadas > 0 ? monto(Math.round(totales.ticketPromedioCentavos / 100) * 100) : "–"}
      />
      <Tarjeta
        etiqueta="Pendiente de cobro"
        valor={monto(totales.pendienteCentavos)}
        detalle={
          aPedido
            ? totales.pendientes === 1
              ? "1 presupuesto aceptado"
              : `${totales.pendientes} presupuestos aceptados`
            : totales.pendientes === 1
              ? "1 pedido reservado"
              : `${totales.pendientes} pedidos reservados`
        }
      />
      {aPedido && (
        // Lo que espera precio no es plata todavía: va como cantidad, nunca como monto.
        <Tarjeta
          etiqueta="Para cotizar"
          valor={(totales.porCotizar ?? 0).toLocaleString("es-AR")}
          detalle={totales.porCotizar === 1 ? "pedido sin precio" : "pedidos sin precio"}
        />
      )}
    </div>
  );
}
