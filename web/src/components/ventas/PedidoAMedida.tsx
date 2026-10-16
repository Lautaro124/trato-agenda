"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { cn } from "@/lib/cn";
import { formatearCentavos } from "@/lib/productos";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_MOTIVO,
  fechaCorta,
  type DetalleVenta,
  type EventoPedido,
  type Presupuesto,
  type PresupuestoAGuardar,
} from "@/lib/ventas";
import { EditorPresupuesto } from "./EditorPresupuesto";
import { loAtendesVos } from "./ListaVentas";

/** Las acciones que la sección le pide al detalle (que las corre y recarga el pedido). */
export type AccionesPedido = {
  trabajando: boolean;
  atender: () => void;
  devolver: (nota: string) => void;
  guardarPresupuesto: (presupuesto: PresupuestoAGuardar) => Promise<boolean>;
  enviarPresupuesto: (presupuesto: Presupuesto) => void;
  descartarPresupuesto: (presupuesto: Presupuesto) => void;
  cobrar: () => void;
};

function Seccion({ titulo, children, extra }: { titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-[15px] font-bold text-ink">{titulo}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** Lo que pidió el cliente: el producto, cada respuesta y el resumen del asistente. */
function LoQuePidio({ venta }: { venta: DetalleVenta }) {
  const solicitud = venta.solicitud;
  return (
    <Seccion titulo="Lo que pidió">
      <p className="text-[14px] font-semibold text-ink">{solicitud?.nombreProducto ?? "Todavía sin producto elegido"}</p>
      {solicitud && solicitud.respuestas.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {solicitud.respuestas.map((dato, i) => (
            <div key={`${dato.pregunta}-${i}`} className="contents">
              <dt className="text-muted">{dato.pregunta}</dt>
              <dd className="break-words text-ink">{dato.respuesta}</dd>
            </div>
          ))}
        </dl>
      )}
      {solicitud?.resumen && <p className="text-[13px] text-ink-secondary">{solicitud.resumen}</p>}
    </Seccion>
  );
}

/** Quién atiende: el asistente o vos (y entonces el asistente no contesta en ese chat). */
function Atencion({ venta, acciones }: { venta: DetalleVenta; acciones: AccionesPedido }) {
  const [nota, setNota] = useState("");
  const cerrado = venta.estado === "pagada" || venta.estado === "cancelada";
  if (loAtendesVos(venta)) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-md bg-danger-subtle p-3 text-[13px] text-danger-text">
        <p>
          <strong>Lo atendés vos</strong>
          {venta.derivadaAt && ` desde el ${fechaCorta(venta.derivadaAt)}`}. El asistente no contesta en este chat hasta
          que se lo devuelvas; escribile al cliente desde tu WhatsApp.
        </p>
        {venta.motivoDerivacion && (
          <p>
            Motivo: {ETIQUETA_MOTIVO[venta.motivoDerivacion] ?? venta.motivoDerivacion}
            {venta.detalleDerivacion && ` · “${venta.detalleDerivacion}”`}
          </p>
        )}
        <label className="text-ink">
          <span className={LABEL}>Qué le dejás dicho al asistente (opcional)</span>
          <input
            className={INPUT}
            value={nota}
            maxLength={500}
            placeholder="Le pasé el precio por teléfono y quedó en confirmar"
            onChange={(e) => setNota(e.target.value)}
          />
        </label>
        <Button variant="secondary" disabled={acciones.trabajando} onClick={() => acciones.devolver(nota)}>
          Devolver al asistente
        </Button>
      </div>
    );
  }
  if (cerrado) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunken p-3 text-[13px] text-ink-secondary">
      <span>Lo atiende tu asistente.{venta.devueltaAt && ` Se lo devolviste el ${fechaCorta(venta.devueltaAt)}.`}</span>
      <Button variant="secondary" size="sm" disabled={acciones.trabajando} onClick={acciones.atender}>
        Atender yo
      </Button>
    </div>
  );
}

const ETIQUETA_PRESUPUESTO: Record<Presupuesto["estado"], string> = {
  borrador: "Sin mandar",
  enviado: "Vigente",
  reemplazado: "Reemplazado",
  descartado: "Descartado",
};

function TarjetaPresupuesto({
  presupuesto,
  acciones,
  puedeMandar,
}: {
  presupuesto: Presupuesto;
  acciones: AccionesPedido;
  puedeMandar: boolean;
}) {
  const vivo = presupuesto.estado === "borrador" || presupuesto.estado === "enviado";
  return (
    <div
      role="group"
      aria-label={`Presupuesto versión ${presupuesto.version}`}
      className={cn("rounded-md border p-3", vivo ? "border-line bg-card" : "border-line bg-sunken opacity-75")}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">
          Versión {presupuesto.version}
          <span className="font-normal text-muted">
            {" "}
            · {presupuesto.origen === "asistente" ? "lo armó el asistente" : "lo armaste vos"} · {fechaCorta(presupuesto.createdAt)}
          </span>
        </span>
        <Badge tone={presupuesto.estado === "enviado" ? "success" : presupuesto.estado === "borrador" ? "warning" : "neutral"}>
          {ETIQUETA_PRESUPUESTO[presupuesto.estado]}
        </Badge>
      </div>
      <table className="w-full text-[13px]">
        <tbody>
          {presupuesto.renglones.map((renglon, i) => (
            <tr key={`${renglon.concepto}-${i}`} className="border-b border-line">
              <td className="py-1.5 text-ink">
                {renglon.concepto}
                {(renglon.cantidad !== 1 || renglon.unidad) && (
                  <span className="block text-[11.5px] text-muted">
                    {String(renglon.cantidad).replace(".", ",")} {renglon.unidad} × {formatearCentavos(renglon.precioUnitarioCentavos)}
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right text-ink tabular-nums">{formatearCentavos(renglon.subtotalCentavos)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-1.5 font-semibold text-ink">Total{presupuesto.estimativo && " (estimativo)"}</td>
            <td className="pt-1.5 text-right font-semibold text-ink tabular-nums">{formatearCentavos(presupuesto.totalCentavos)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1.5 text-[12px] text-muted">
        {presupuesto.detalleAlCliente ? "El cliente ve cada renglón." : "Al cliente le llega sólo el total."}
        {presupuesto.enviadoAt && ` Mandado el ${fechaCorta(presupuesto.enviadoAt)}.`}
      </p>
      {presupuesto.nota && <p className="mt-1 text-[12.5px] text-ink-secondary">“{presupuesto.nota}”</p>}
      {presupuesto.estado === "borrador" && puedeMandar && (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={acciones.trabajando} onClick={() => acciones.descartarPresupuesto(presupuesto)}>
            Descartar
          </Button>
          <Button size="sm" disabled={acciones.trabajando} onClick={() => acciones.enviarPresupuesto(presupuesto)}>
            {presupuesto.origen === "asistente" ? "Aprobar y mandar" : "Mandar al cliente"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Los presupuestos del pedido, el editor y el cobro del vigente. */
function Presupuestos({ venta, acciones }: { venta: DetalleVenta; acciones: AccionesPedido }) {
  const [editando, setEditando] = useState(false);
  const abierto = !["pagada", "cancelada"].includes(venta.estado);
  const vigente = venta.presupuestos.find((p) => p.estado === "enviado") ?? null;
  const borrador = venta.presupuestos.find((p) => p.estado === "borrador") ?? null;
  const base = borrador ?? vigente;
  // Del más nuevo al más viejo: lo que importa queda arriba.
  const lista = [...venta.presupuestos].reverse();
  const puedeCobrar = vigente !== null && (venta.estado === "cotizado" || venta.estado === "vencida");

  return (
    <Seccion
      titulo="Presupuesto"
      extra={
        abierto &&
        !editando && (
          <Button variant="secondary" size="sm" disabled={acciones.trabajando} onClick={() => setEditando(true)}>
            {base ? "Armar otra versión" : "Armar presupuesto"}
          </Button>
        )
      }
    >
      {editando && (
        <EditorPresupuesto
          inicial={base}
          trabajando={acciones.trabajando}
          onCancelar={() => setEditando(false)}
          onGuardar={(presupuesto) => {
            void acciones.guardarPresupuesto(presupuesto).then((ok) => ok && setEditando(false));
          }}
        />
      )}
      {lista.length === 0 && !editando && (
        <p className="text-[13px] text-muted">
          Todavía no tiene. Armalo y mandáselo: le llega al cliente por su chat y el asistente lo cobra cuando diga que sí.
        </p>
      )}
      {lista.map((presupuesto) => (
        <TarjetaPresupuesto key={presupuesto.id} presupuesto={presupuesto} acciones={acciones} puedeMandar={abierto} />
      ))}
      {puedeCobrar && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunken p-3 text-[13px] text-ink-secondary">
          <span>Cuando el cliente dice que sí, el asistente genera el cobro. Si ya te confirmó por otro lado, generalo vos.</span>
          <Button size="sm" disabled={acciones.trabajando} onClick={acciones.cobrar}>
            Generar el cobro
          </Button>
        </div>
      )}
    </Seccion>
  );
}

const QUIEN: Record<"cliente" | "asistente" | "dueno", string> = { cliente: "Cliente", asistente: "Asistente", dueno: "Vos" };

/** Lo último del chat, para tomar el caso sin preguntarle de nuevo al cliente. */
function Conversacion({ venta }: { venta: DetalleVenta }) {
  if (venta.mensajes.length === 0) return null;
  return (
    <Seccion titulo="Conversación">
      <ol aria-label="Mensajes del chat" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-md bg-sunken p-3">
        {venta.mensajes.map((mensaje, i) => (
          <li
            key={`${mensaje.createdAt}-${i}`}
            className={cn(
              "max-w-[85%] rounded-md px-3 py-1.5 text-[13px] whitespace-pre-line",
              mensaje.de === "cliente" ? "self-start bg-card text-ink" : "self-end bg-primary-subtle text-ink",
            )}
          >
            <span className="block text-[11px] font-semibold text-muted">
              {QUIEN[mensaje.de]} · {fechaCorta(mensaje.createdAt)}
            </span>
            {mensaje.texto}
          </li>
        ))}
      </ol>
    </Seccion>
  );
}

const AUTOR: Record<EventoPedido["autor"], string> = {
  asistente: "el asistente",
  dueno: "vos",
  sistema: "el sistema",
  mercadopago: "Mercado Pago",
};

function textoDeEvento(evento: EventoPedido): string {
  switch (evento.tipo) {
    case "estado":
      return `Pasó a ${(ETIQUETA_ESTADO[evento.a as keyof typeof ETIQUETA_ESTADO] ?? evento.a ?? "").toLowerCase()}`;
    case "derivacion":
      return `Pasó a atención humana${evento.motivo ? ` (${(ETIQUETA_MOTIVO[evento.motivo] ?? evento.motivo).toLowerCase()})` : ""}`;
    case "devolucion":
      return "Volvió al asistente";
    case "presupuesto":
      return `Presupuesto ${evento.a ?? ""}`.trim();
    case "cobro":
      return "Cobro";
  }
}

function Historial({ venta }: { venta: DetalleVenta }) {
  if (venta.eventos.length === 0) return null;
  return (
    <Seccion titulo="Historial">
      <ol aria-label="Historial del pedido" className="flex flex-col gap-1 text-[12.5px]">
        {venta.eventos.map((evento, i) => (
          <li key={`${evento.createdAt}-${i}`} className="flex flex-wrap justify-between gap-x-3">
            <span className="text-ink">
              {textoDeEvento(evento)} <span className="text-muted">· {AUTOR[evento.autor]}</span>
            </span>
            <span className="text-muted tabular-nums">{fechaCorta(evento.createdAt)}</span>
          </li>
        ))}
      </ol>
    </Seccion>
  );
}

/** Todo lo de un pedido a medida dentro del detalle. */
export function PedidoAMedida({ venta, acciones }: { venta: DetalleVenta; acciones: AccionesPedido }) {
  return (
    <div className="mb-4 flex flex-col gap-4">
      <Atencion venta={venta} acciones={acciones} />
      <LoQuePidio venta={venta} />
      <Presupuestos venta={venta} acciones={acciones} />
      <Conversacion venta={venta} />
      <Historial venta={venta} />
    </div>
  );
}
