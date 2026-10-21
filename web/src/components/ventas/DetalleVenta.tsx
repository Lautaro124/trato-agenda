"use client";

import { Fragment, useEffect, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { ErrorDeApi, formatearCentavos, formatearMonto } from "@/lib/productos";
import {
  cambiarAtencion,
  cancelarVenta,
  cobrarPedido,
  crearPresupuesto,
  descartarPresupuesto,
  enviarPresupuesto,
  ETIQUETA_ESTADO,
  fechaCorta,
  marcarPagada,
  presupuestoDesdeReceta,
  type DetalleVenta as Detalle,
} from "@/lib/ventas";
import { loAtendesVos, TONO_ESTADO, totalDeVenta } from "./ListaVentas";
import { PedidoAMedida, type AccionesPedido } from "./PedidoAMedida";

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
  const [aviso, setAviso] = useState<string | null>(null);
  const aMedida = venta.tipo === "a_medida";
  const sinPagar = venta.estado === "pendiente_pago" || venta.estado === "vencida";
  const cancelable = sinPagar || ["solicitado", "a_cotizar", "cotizado"].includes(venta.estado);

  useEffect(() => {
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alEscape);
    return () => document.removeEventListener("keydown", alEscape);
  }, [onCerrar]);

  /** Corre una acción sobre el pedido y lo reemplaza por lo que devuelve la API. true si salió bien. */
  const correr = (hacer: () => Promise<Detalle>, confirmacion?: string): Promise<boolean> => {
    if (confirmacion && !window.confirm(confirmacion)) return Promise.resolve(false);
    setTrabajando(true);
    setError(null);
    setAviso(null);
    return hacer()
      .then((actualizado) => {
        onCambio(actualizado);
        return true;
      })
      .catch((err: unknown) => {
        setError(err instanceof ErrorDeApi ? err.message : "No se pudo. Probá de nuevo.");
        return false;
      })
      .finally(() => setTrabajando(false));
  };
  const accion = (hacer: () => Promise<Detalle>, confirmacion: string) => void correr(hacer, confirmacion);

  /** Cuando el chat no está vinculado el presupuesto queda guardado igual: se avisa que no llegó. */
  const avisarSiNoLlego = (actualizado: Detalle & { mandado?: boolean }) => {
    if (actualizado.mandado === false && !actualizado.dePrueba) {
      setAviso("Quedó como presupuesto vigente, pero no le pudimos mandar el mensaje: pasáselo vos por WhatsApp.");
    }
    return actualizado;
  };

  const acciones: AccionesPedido = {
    trabajando,
    atender: () =>
      accion(
        () => cambiarAtencion(venta.id, true),
        "¿Lo atendés vos? Tu asistente deja de contestar en ese chat hasta que se lo devuelvas.",
      ),
    devolver: (nota) => void correr(() => cambiarAtencion(venta.id, false, nota)),
    guardarPresupuesto: (presupuesto) =>
      correr(
        () => crearPresupuesto(venta.id, presupuesto).then(avisarSiNoLlego),
        presupuesto.enviar
          ? "¿Mandárselo al cliente? Le llega por su chat y pasa a ser el presupuesto vigente (si había otro link de pago, deja de valer)."
          : undefined,
      ),
    enviarPresupuesto: (presupuesto) =>
      accion(
        () => enviarPresupuesto(venta.id, presupuesto.id).then(avisarSiNoLlego),
        "¿Mandárselo al cliente? Le llega por su chat y pasa a ser el presupuesto vigente.",
      ),
    descartarPresupuesto: (presupuesto) =>
      accion(() => descartarPresupuesto(venta.id, presupuesto.id), "¿Descartar este presupuesto sin mandarlo?"),
    desdeReceta: () => void correr(() => presupuestoDesdeReceta(venta.id)),
    cobrar: () =>
      accion(
        () => cobrarPedido(venta.id),
        "¿Generar el cobro del presupuesto vigente? Si tenés Mercado Pago conectado se crea el link; si no, queda para coordinar.",
      ),
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center sm:p-6" onClick={onCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-md sm:rounded-lg sm:pb-5",
          aMedida ? "max-w-[720px]" : "max-w-[560px]",
        )}
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
            {aMedida && <Badge tone="neutral">A medida</Badge>}
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

        {aMedida && <PedidoAMedida venta={venta} acciones={acciones} />}

        {!aMedida && (
        <table className="mb-4 w-full text-[13.5px]">
          <tbody>
            {venta.items.map((item, i) => (
              <tr key={`${item.codigo}-${i}`} className="border-b border-line">
                <td className="py-2 text-ink">
                  {item.cantidad} × {item.nombreProducto}
                  {item.nombreVariante && <span className="text-ink-secondary"> ({item.nombreVariante})</span>}
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
                </td>
                <td className="py-2 text-right text-ink tabular-nums">{formatearMonto(item.subtotalCentavos, venta.moneda)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-2 font-semibold text-ink">Total</td>
              <td className="pt-2 text-right font-semibold text-ink tabular-nums">{totalDeVenta(venta)}</td>
            </tr>
          </tbody>
        </table>
        )}

        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Cobro</dt>
          <dd className="text-ink">
            {venta.medioPago === "mercadopago"
              ? "Link de Mercado Pago"
              : venta.medioPago === "manual"
                ? "A coordinar con vos"
                : "Todavía no se cobra"}
          </dd>
          {aMedida && venta.totalCentavos !== null && (
            <>
              <dt className="text-muted">Total</dt>
              <dd className="font-semibold text-ink tabular-nums">{formatearCentavos(venta.totalCentavos)}</dd>
            </>
          )}
          {aMedida && venta.estado === "pendiente_pago" && venta.linkPago && (
            <>
              <dt className="text-muted">Link de pago</dt>
              <dd className="break-all">
                <a href={venta.linkPago} target="_blank" rel="noopener noreferrer" className="text-link">
                  {venta.linkPago}
                </a>
              </dd>
            </>
          )}
          {venta.entrega && (
            <>
              <dt className="text-muted">Entrega</dt>
              <dd className="text-ink">{venta.entrega === "envio" ? "Con envío" : "Lo retira"}</dd>
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
              <dt className="text-muted">{aMedida ? "El cobro vale hasta" : "Reservado hasta"}</dt>
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
        {aviso && (
          <p role="status" className="mb-3 text-sm text-warning-text">
            {aviso}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {cancelable && (
            <Button
              variant="secondary"
              disabled={trabajando}
              onClick={() =>
                accion(
                  () => cancelarVenta(venta.id),
                  aMedida
                    ? "¿Cancelar el pedido? Si tenía un link de pago, deja de valer."
                    : "¿Cancelar el pedido? Se libera la reserva del stock.",
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
                      ? `¿Te pagó por otro medio? Si lo marcás pagado${aMedida ? "" : " se descuenta el stock;"} si además paga el link de Mercado Pago, vas a tener que devolverle uno de los dos pagos.`
                      : aMedida
                        ? "¿Marcar el pedido como pagado?"
                        : "¿Marcar el pedido como pagado? Se descuenta el stock.",
                  )
                }
              >
                Marcar pagada
              </Button>
            </>
          )}
          {!cancelable && (
            <Button variant="secondary" onClick={onCerrar}>
              Cerrar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
