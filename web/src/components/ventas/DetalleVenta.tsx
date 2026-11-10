"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { useAvisos, type Confirmacion } from "@/components/ui/Avisos";
import { Button } from "@/components/ui/Button";
import { ErrorDeApi, formatearMonto } from "@/lib/productos";
import {
  cancelarVenta,
  devolverAlAsistente,
  ETIQUETA_ESTADO,
  fechaCorta,
  marcarPagada,
  type DetalleVenta as Detalle,
} from "@/lib/ventas";
import { AtencionPedido } from "./AtencionPedido";
import { loAtendesVos, TONO_ESTADO, totalDeVenta } from "./ListaVentas";

/** El detalle de un pedido, con las acciones del dueño si todavía no se pagó. */
export function DetalleVenta({
  venta,
  onCerrar,
  onCambio,
}: {
  venta: Detalle;
  onCerrar: () => void;
  onCambio: (venta: Detalle) => void;
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

  const { confirmar } = useAvisos();

  /** Corre una acción sobre el pedido y lo reemplaza por lo que devuelve la API. */
  const correr = async (hacer: () => Promise<Detalle>, confirmacion?: Confirmacion): Promise<void> => {
    if (confirmacion && !(await confirmar(confirmacion))) return;
    setTrabajando(true);
    setError(null);
    return hacer()
      .then(onCambio)
      .catch((err: unknown) => setError(err instanceof ErrorDeApi ? err.message : "No se pudo. Probá de nuevo."))
      .finally(() => setTrabajando(false));
  };
  const accion = (hacer: () => Promise<Detalle>, confirmacion: Confirmacion) => void correr(hacer, confirmacion);

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
            {loAtendesVos(venta) && <Badge tone="danger">Lo atendés vos</Badge>}
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

        {loAtendesVos(venta) && (
          <div className="mb-4">
            <AtencionPedido
              venta={venta}
              trabajando={trabajando}
              onDevolver={(nota) => void correr(() => devolverAlAsistente(venta.id, nota))}
            />
          </div>
        )}

        <table className="mb-4 w-full text-[13.5px]">
          <tbody>
            {venta.items.map((item, i) => (
              <tr key={`${item.codigo}-${i}`} className="border-b border-line">
                <td className="py-2 text-ink">
                  {item.cantidad} × {item.nombreProducto}
                  <span className="block text-[11.5px] text-muted">
                    {item.codigo} · {formatearMonto(item.precioUnitarioCentavos, venta.moneda)} c/u
                    {item.descuentoCentavos > 0 && item.precioListaCentavos !== null && (
                      <>
                        {" "}
                        <span className="line-through">{formatearMonto(item.precioListaCentavos, venta.moneda)}</span>
                        {item.descuentoEtiqueta && ` · ${item.descuentoEtiqueta}`}
                      </>
                    )}
                  </span>
                  {item.respuestas.length > 0 && (
                    <ul className="mt-1 text-[12.5px] text-ink-secondary">
                      {item.respuestas.map((r) => (
                        <li key={r.pregunta}>
                          {r.pregunta} <span className="font-semibold text-ink">{r.respuesta}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2 text-right text-ink tabular-nums">{formatearMonto(item.subtotalCentavos, venta.moneda)}</td>
              </tr>
            ))}
            {venta.envioModalidad && (
              <tr className="border-b border-line">
                <td className="py-2 text-ink">
                  {venta.envioModalidad === "sucursal" ? "Envío a sucursal del correo" : "Envío a domicilio"}
                </td>
                <td className="py-2 text-right text-ink tabular-nums">
                  {venta.envioCentavos > 0 ? formatearMonto(venta.envioCentavos, venta.moneda) : "Gratis"}
                </td>
              </tr>
            )}
            <tr>
              <td className="pt-2 font-semibold text-ink">Total</td>
              <td className="pt-2 text-right font-semibold text-ink tabular-nums">{totalDeVenta(venta)}</td>
            </tr>
          </tbody>
        </table>

        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Cobro</dt>
          <dd className="text-ink">
            {venta.medioPago === "mercadopago"
              ? "Link de Mercado Pago"
              : "A coordinar con vos"}
          </dd>
          {venta.formaPago && (
            <>
              <dt className="text-muted">Forma de pago</dt>
              <dd className="text-ink">
                {venta.formaPago === "efectivo"
                  ? "Efectivo, con descuento"
                  : `${venta.cuotas} cuotas` +
                    (venta.recargoCentavos > 0
                      ? ` (incluye ${formatearMonto(venta.recargoCentavos, venta.moneda)} de recargo)`
                      : " sin interés")}
              </dd>
            </>
          )}
          {venta.entrega && (
            <>
              <dt className="text-muted">Entrega</dt>
              <dd className="text-ink">
                {venta.entrega !== "envio"
                  ? "Lo retira"
                  : venta.envioModalidad
                    ? "Con envío, incluido en el total"
                    : "Con envío, a coordinar aparte"}
              </dd>
            </>
          )}
          {/* `?? []`: una venta cacheada de antes de este campo no lo trae. */}
          {(venta.datosCliente ?? []).map((dato, i) => (
            <Fragment key={`${dato.etiqueta}-${i}`}>
              <dt className="text-muted">{dato.etiqueta}</dt>
              <dd className="break-words text-ink">{dato.valor}</dd>
            </Fragment>
          ))}
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
          {venta.estado === "pendiente_pago" && venta.reservaVenceAt && (
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
            <Button
              variant="secondary"
              disabled={trabajando}
              onClick={() =>
                accion(
                  () => cancelarVenta(venta.id),
                  {
                    titulo: "¿Cancelar el pedido?",
                    texto: "Se libera la reserva del stock.",
                    confirmar: "Sí, cancelar pedido",
                    cancelar: "Volver",
                  },
                )
              }
            >
              Cancelar pedido
            </Button>
          )}
          {sinPagar && (
            <>
              <Button
                disabled={trabajando}
                onClick={() =>
                  accion(
                    () => marcarPagada(venta.id),
                    venta.medioPago === "mercadopago"
                      ? {
                          titulo: "¿Te pagó por otro medio?",
                          texto:
                            "Si lo marcás pagado se descuenta el stock; si además paga el link de Mercado Pago, vas a tener que devolverle uno de los dos pagos.",
                          confirmar: "Marcar pagada",
                          tono: "cuidado",
                        }
                      : {
                          titulo: "¿Marcar el pedido como pagado?",
                          texto: "Se descuenta el stock.",
                          confirmar: "Marcar pagada",
                          tono: "cuidado",
                        },
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
