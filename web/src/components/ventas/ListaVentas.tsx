"use client";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatearMonto } from "@/lib/productos";
import { ETIQUETA_ESTADO, fechaCorta, resumenDeVenta, type EstadoVenta, type Venta } from "@/lib/ventas";

/** Estado → tono de Badge. Los colores de estado sólo cuando el estado significa algo bueno o a atender. */
export const TONO_ESTADO: Record<EstadoVenta, "success" | "warning" | "neutral" | "info"> = {
  solicitado: "info",
  a_cotizar: "warning",
  cotizado: "info",
  pagada: "success",
  pendiente_pago: "warning",
  vencida: "neutral",
  cancelada: "neutral",
};

/** El total, o qué falta para tenerlo en un pedido a medida sin cotizar. */
export function totalDeVenta(venta: Pick<Venta, "totalCentavos" | "moneda">): string {
  return venta.totalCentavos === null ? "Sin precio" : formatearMonto(venta.totalCentavos, venta.moneda);
}

/** Un pedido abierto que atendés vos: el asistente no contesta en ese chat. */
export function loAtendesVos(venta: Pick<Venta, "atencion" | "estado">): boolean {
  return venta.atencion === "humana" && !["pagada", "cancelada"].includes(venta.estado);
}

/** El listado del histórico: una fila por pedido, con el detalle al tocarla. */
export function ListaVentas({ ventas, onElegir }: { ventas: Venta[]; onElegir: (venta: Venta) => void }) {
  if (ventas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong bg-card p-6 text-center text-sm text-muted">
        No hay ventas con estos filtros.
      </p>
    );
  }
  return (
    <ul aria-label="Ventas" className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-card">
      {ventas.map((venta) => (
        <li key={venta.id}>
          {/* En el celular: cliente arriba, y abajo fecha y estado a la izquierda y el total a
              la derecha. Desde sm, cuatro columnas; el envoltorio de fecha y estado se
              disuelve (`contents`) y el orden lo pone `sm:order-*`. */}
          <button
            type="button"
            onClick={() => onElegir(venta)}
            className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-sunken sm:grid-cols-[110px_minmax(0,1fr)_auto_auto]"
          >
            <span className="col-span-2 min-w-0 sm:order-2 sm:col-span-1">
              <span className="block truncate text-[14px] font-semibold text-ink">{venta.nombreCliente ?? "Sin nombre"}</span>
              <span className="block truncate text-[12.5px] text-ink-secondary">{resumenDeVenta(venta)}</span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:contents">
              <span className="text-[12.5px] text-muted sm:order-1">{fechaCorta(venta.createdAt)}</span>
              <span className="flex flex-wrap gap-1 sm:order-3 sm:justify-end">
                {venta.dePrueba && <Badge tone="info">Prueba</Badge>}
                {loAtendesVos(venta) && <Badge tone="danger">Lo atendés vos</Badge>}
                {venta.entrega === "envio" && <Badge tone="neutral">Envío</Badge>}
                <Badge tone={TONO_ESTADO[venta.estado]}>{ETIQUETA_ESTADO[venta.estado]}</Badge>
                {venta.sinStockAlPagar && <Badge tone="danger">Sin stock al pagar</Badge>}
              </span>
            </span>
            <span
              className={cn(
                "text-right text-[14px] font-semibold tabular-nums sm:order-4",
                venta.totalCentavos === null ? "text-muted" : "text-ink",
              )}
            >
              {totalDeVenta(venta)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
