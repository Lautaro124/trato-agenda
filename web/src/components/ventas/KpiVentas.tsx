"use client";

import { formatearMonto } from "@/lib/productos";
import { pesosCompactos, type Totales } from "@/lib/ventas";

/** Montos de más de diez millones van compactos: la tarjeta es angosta. */
function monto(centavos: number, moneda: string): string {
  return centavos >= 1_000_000_000 ? pesosCompactos(centavos, moneda) : formatearMonto(centavos, moneda);
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
export function KpiVentas({ totales, moneda = "ARS" }: { totales: Totales; moneda?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tarjeta etiqueta="Cobrado" valor={monto(totales.cobradoCentavos, moneda)} />
      <Tarjeta etiqueta="Ventas pagadas" valor={totales.pagadas.toLocaleString("es-AR")} />
      {/* Un promedio con centavos es precisión de más: va redondeado al peso. */}
      <Tarjeta
        etiqueta="Ticket promedio"
        valor={totales.pagadas > 0 ? monto(Math.round(totales.ticketPromedioCentavos / 100) * 100, moneda) : "–"}
      />
      <Tarjeta
        etiqueta="Pendiente de cobro"
        valor={monto(totales.pendienteCentavos, moneda)}
        detalle={totales.pendientes === 1 ? "1 pedido por cobrar" : `${totales.pendientes} pedidos por cobrar`}
      />
    </div>
  );
}
