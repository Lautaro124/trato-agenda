"use client";

import { useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorDeApi, formatearCentavos } from "@/lib/productos";
import { cancelarVenta, ETIQUETA_ESTADO, fechaCorta, marcarPagada, type Venta } from "@/lib/ventas";
import { TONO_ESTADO } from "./ListaVentas";

/** El detalle de un pedido, con las acciones del dueño si todavía no se pagó. */
export function DetalleVenta({
  venta,
  onCerrar,
  onCambio,
}: {
  venta: Venta;
  onCerrar: () => void;
  onCambio: (venta: Venta) => void;
}) {
  const titulo = useId();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sinPagar = venta.estado === "pendiente_pago" || venta.estado === "vencida";

  useEffect(() => {
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alEscape);
    return () => document.removeEventListener("keydown", alEscape);
  }, [onCerrar]);

  const accion = (hacer: () => Promise<Venta>, confirmacion: string) => {
    if (!window.confirm(confirmacion)) return;
    setTrabajando(true);
    setError(null);
    hacer()
      .then(onCambio)
      .catch((err: unknown) => setError(err instanceof ErrorDeApi ? err.message : "No se pudo. Probá de nuevo."))
      .finally(() => setTrabajando(false));
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center sm:p-6" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-[560px] overflow-y-auto rounded-t-lg bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-md sm:rounded-lg sm:pb-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id={titulo} className="font-display text-[20px] font-bold text-ink">
              {venta.nombreCliente ?? "Pedido sin nombre"}
            </h2>
            <p className="text-[12.5px] text-muted">Pedido del {fechaCorta(venta.createdAt)}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {venta.dePrueba && <Badge tone="info">Prueba</Badge>}
            <Badge tone={TONO_ESTADO[venta.estado]}>{ETIQUETA_ESTADO[venta.estado]}</Badge>
            {venta.sinStockAlPagar && <Badge tone="danger">Sin stock al pagar</Badge>}
          </div>
        </div>

        {venta.sinStockAlPagar && (
          <p className="mb-4 rounded-md bg-danger-subtle p-3 text-[13px] text-danger-text">
            Se pagó cuando la reserva ya había vencido y no quedaba stock para cubrirlo. Devolvé el pago desde Mercado
            Pago o reponé el producto.
          </p>
        )}

        <table className="mb-4 w-full text-[13.5px]">
          <tbody>
            {venta.items.map((item, i) => (
              <tr key={`${item.codigo}-${i}`} className="border-b border-line">
                <td className="py-2 text-ink">
                  {item.cantidad} × {item.nombreProducto}
                  {item.nombreVariante && <span className="text-ink-secondary"> ({item.nombreVariante})</span>}
                  <span className="block text-[11.5px] text-muted">
                    {item.codigo} · {formatearCentavos(item.precioUnitarioCentavos)} c/u
                  </span>
                </td>
                <td className="py-2 text-right text-ink tabular-nums">{formatearCentavos(item.subtotalCentavos)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-2 font-semibold text-ink">Total</td>
              <td className="pt-2 text-right font-semibold text-ink tabular-nums">{formatearCentavos(venta.totalCentavos)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Cobro</dt>
          <dd className="text-ink">{venta.medioPago === "mercadopago" ? "Link de Mercado Pago" : "A coordinar con vos"}</dd>
          {venta.telefonoCliente && (
            <>
              <dt className="text-muted">WhatsApp</dt>
              <dd>
                <a
                  href={`https://wa.me/${venta.telefonoCliente}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link"
                >
                  +{venta.telefonoCliente}
                </a>
              </dd>
            </>
          )}
          {venta.estado === "pendiente_pago" && (
            <>
              <dt className="text-muted">Reservado hasta</dt>
              <dd className="text-ink">{fechaCorta(venta.reservaVenceAt)}</dd>
            </>
          )}
          {venta.pagadaAt && (
            <>
              <dt className="text-muted">Pagada el</dt>
              <dd className="text-ink">{fechaCorta(venta.pagadaAt)}</dd>
            </>
          )}
          {venta.mpPaymentId && (
            <>
              <dt className="text-muted">Operación de Mercado Pago</dt>
              <dd className="text-ink tabular-nums">{venta.mpPaymentId}</dd>
            </>
          )}
          {venta.canceladaAt && (
            <>
              <dt className="text-muted">Cancelada el</dt>
              <dd className="text-ink">{fechaCorta(venta.canceladaAt)}</dd>
            </>
          )}
        </dl>

        {error && (
          <p role="alert" className="mb-3 text-sm text-danger-text">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {sinPagar && (
            <>
              <Button
                variant="secondary"
                disabled={trabajando}
                onClick={() => accion(() => cancelarVenta(venta.id), "¿Cancelar el pedido? Se libera la reserva del stock.")}
              >
                Cancelar pedido
              </Button>
              <Button
                disabled={trabajando}
                onClick={() =>
                  accion(
                    () => marcarPagada(venta.id),
                    venta.medioPago === "mercadopago"
                      ? "¿Te pagó por otro medio? Si lo marcás pagado se descuenta el stock; si además paga el link de Mercado Pago, vas a tener que devolverle uno de los dos pagos."
                      : "¿Marcar el pedido como pagado? Se descuenta el stock.",
                  )
                }
              >
                Marcar pagada
              </Button>
            </>
          )}
          {!sinPagar && (
            <Button variant="secondary" onClick={onCerrar}>
              Cerrar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
