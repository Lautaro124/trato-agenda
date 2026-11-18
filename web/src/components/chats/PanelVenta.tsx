"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { CambioDeTrato, EstadoTrato, FichaChat, ProductoDeInteres } from "@/lib/chats";
import { cn } from "@/lib/cn";
import { formatearMonto, listarProductos, type Producto } from "@/lib/productos";
import { ETIQUETA_ESTADO, type EstadoVenta } from "@/lib/ventas";

const OPCION_HECHO = { id: "hecho" as EstadoTrato, label: "Trato hecho", activo: "border-primary bg-primary-subtle text-primary-active" };
const OPCION_PAGADO = { id: "pagado" as EstadoTrato, label: "Pagado", activo: "border-success-text bg-success-subtle text-success-text" };
const OPCION_CANCELADO = { id: "cancelado" as EstadoTrato, label: "Cancelado", activo: "border-danger-text bg-danger-subtle text-danger-text" };

const AYUDA: Record<EstadoTrato | "ninguno", string> = {
  ninguno: "Marcalo vos cuando cierres el trato por fuera del bot.",
  hecho: "Acordaron la venta. El pedido queda pendiente de pago y reserva el stock.",
  pagado: "Cuenta como venta en tus indicadores y descuenta el stock.",
  cancelado: "El trato se cayó. Si había un pedido sin pagar, se canceló y el stock quedó libre.",
};

/** Lo que tiene que mostrar el dueño para cerrar la venta: resumen, interés, precios y el estado del trato. */
export function PanelVenta({
  ficha,
  error,
  trabajando,
  onTrato,
}: Readonly<{
  ficha: FichaChat | null;
  error: boolean;
  trabajando: boolean;
  /** Devuelve true si se guardó. */
  onTrato: (cambio: CambioDeTrato) => Promise<boolean>;
}>) {
  const [armando, setArmando] = useState<"hecho" | "pagado" | null>(null);

  if (error) return <p className="text-sm text-danger-text">No pudimos cargar los datos de la venta.</p>;
  if (!ficha) return <p className="text-sm text-muted">Cargando los datos de la venta…</p>;

  // Sin pedido abierto, "Trato hecho" y "Pagado" piden armarlo; con uno, sólo cambian su estado.
  const pedidoAbierto = ficha.pedido && (ficha.pedido.estado === "pendiente_pago" || ficha.pedido.estado === "vencida");
  const pedidoPagado = ficha.pedido?.estado === "pagada";
  // Con el trato hecho (o pagado) sólo queda el cobro; antes, "Trato hecho" o "Cancelado".
  const enCierre = ficha.trato === "hecho" || ficha.trato === "pagado";
  const opciones = enCierre
    ? [{ ...OPCION_PAGADO, label: ficha.trato === "pagado" ? "Pagado" : "Marcar como pagado" }]
    : [OPCION_HECHO, OPCION_CANCELADO];
  const elegir = (estado: EstadoTrato) => {
    if (estado === ficha.trato) return;
    if (estado !== "cancelado" && !pedidoAbierto && !pedidoPagado) setArmando(estado);
    else void onTrato({ estado });
  };

  const pedidos = ficha.productos.filter((producto) => producto.tipo === "pidio");

  if (armando) {
    return (
      <FormularioTicket
        estado={armando}
        interes={ficha.productos}
        trabajando={trabajando}
        onCancelar={() => setArmando(null)}
        onCrear={async (cambio) => {
          if (await onTrato(cambio)) setArmando(null);
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section aria-labelledby="titulo-resumen" className="flex flex-none flex-col gap-1.5">
        <h3 id="titulo-resumen" className="text-xs font-bold text-ink-secondary">
          Resumen del chat
        </h3>
        <p className="text-sm leading-[1.5] text-ink">
          {ficha.resumen || "Tu asistente todavía no guardó un resumen de este cliente."}
        </p>
      </section>

      <section aria-labelledby="titulo-interes" className="flex min-h-0 flex-1 flex-col gap-2">
        <h3 id="titulo-interes" className="text-xs font-bold text-ink-secondary">
          Le interesa
        </h3>
        {pedidos.length === 0 ? (
          <p className="text-sm text-ink-secondary">Todavía no pidió productos.</p>
        ) : (
          <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {pedidos.map((producto) => (
              <ProductoInteres key={producto.id} producto={producto} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-trato" className="flex flex-none flex-col gap-2.5 border-t border-line pt-4">
        <h3 id="titulo-trato" className="text-xs font-bold text-ink-secondary">
          Estado del trato
        </h3>
        <div role="group" aria-labelledby="titulo-trato" className={cn("grid gap-1.5", enCierre ? "grid-cols-1" : "grid-cols-2")}>
          {opciones.map((opcion) => {
            const activo = ficha.trato === opcion.id;
            return (
              <button
                key={opcion.id}
                type="button"
                aria-pressed={activo}
                disabled={trabajando}
                onClick={() => elegir(opcion.id)}
                className={cn(
                  "min-h-11 cursor-pointer rounded-md border px-1.5 text-[13px] font-bold disabled:cursor-default disabled:opacity-60",
                  activo ? cn("border-2", opcion.activo) : "border-line bg-card text-ink-secondary hover:bg-sunken",
                )}
              >
                {opcion.label}
              </button>
            );
          })}
        </div>
        {ficha.pedido && (
          <p className="flex justify-between gap-2 text-sm">
            <span>
              Último pedido · {(ETIQUETA_ESTADO[ficha.pedido.estado as EstadoVenta] ?? ficha.pedido.estado).toLowerCase()}
            </span>
            {ficha.pedido.totalCentavos !== null && (
              <strong>{formatearMonto(ficha.pedido.totalCentavos, ficha.pedido.moneda)}</strong>
            )}
          </p>
        )}
        <p className="text-[13px] leading-[1.45] text-ink-secondary">{AYUDA[ficha.trato ?? "ninguno"]}</p>
      </section>
    </div>
  );
}

function ProductoInteres({ producto }: Readonly<{ producto: ProductoDeInteres }>) {
  return <li className="truncate rounded-md bg-sunken px-2.5 py-1.5 text-[13px] font-semibold text-ink">{producto.nombre}</li>;
}

type Renglon = { id: string; nombre: string; cantidad: number };

/**
 * El ticket del trato: productos y cantidades, y cómo paga. El total lo
 * calcula la API con los precios y promos del momento.
 */
function FormularioTicket({
  estado,
  interes,
  trabajando,
  onCancelar,
  onCrear,
}: Readonly<{
  estado: "hecho" | "pagado";
  interes: ProductoDeInteres[];
  trabajando: boolean;
  onCancelar: () => void;
  onCrear: (cambio: CambioDeTrato) => Promise<void>;
}>) {
  // Arranca con lo que pidió; si no pidió nada, con lo primero que vio.
  const pedidos = interes.filter((producto) => producto.tipo === "pidio");
  const iniciales = (pedidos.length > 0 ? pedidos : interes.slice(0, 1)).map((p) => p.id);
  const [renglones, setRenglones] = useState<Renglon[]>(
    interes.map((producto) => ({ id: producto.id, nombre: producto.nombre, cantidad: iniciales.includes(producto.id) ? 1 : 0 })),
  );
  const [forma, setForma] = useState("contado");
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Producto[] | null>(null);

  const elegidos = renglones.filter((renglon) => renglon.cantidad > 0);
  // Cuotas: los planes que comparten los productos de interés elegidos (la API vuelve a validar).
  const planes = elegidos.reduce<number[] | null>((comunes, renglon) => {
    const delProducto = interes.find((producto) => producto.id === renglon.id)?.planes.map((plan) => plan.cuotas) ?? [];
    return comunes === null ? delProducto : comunes.filter((cuotas) => delProducto.includes(cuotas));
  }, null) ?? [];
  const hayEfectivo = interes.some((producto) => producto.efectivoCentavos !== null);

  const cambiarCantidad = (id: string, cantidad: number) =>
    setRenglones((previos) => previos.map((renglon) => (renglon.id === id ? { ...renglon, cantidad } : renglon)));

  const buscar = async () => {
    const q = busqueda.trim();
    if (!q) return;
    const listado = await listarProductos({ q }).catch(() => null);
    setResultados(listado?.productos.filter((producto) => producto.activo).slice(0, 5) ?? []);
  };

  const agregar = (producto: Producto) => {
    setRenglones((previos) =>
      previos.some((renglon) => renglon.id === producto.id)
        ? previos.map((renglon) => (renglon.id === producto.id ? { ...renglon, cantidad: Math.max(1, renglon.cantidad) } : renglon))
        : [...previos, { id: producto.id, nombre: producto.nombre, cantidad: 1 }],
    );
    setResultados(null);
    setBusqueda("");
  };

  const crear = () => {
    const [formaPago, cuotas] = forma.startsWith("cuotas-")
      ? (["cuotas", Number(forma.slice(7))] as const)
      : forma === "efectivo"
        ? (["efectivo", undefined] as const)
        : ([undefined, undefined] as const);
    void onCrear({
      estado,
      items: elegidos.map((renglon) => ({ productoId: renglon.id, cantidad: renglon.cantidad })),
      ...(formaPago ? { formaPago } : {}),
      ...(cuotas ? { cuotas } : {}),
    });
  };

  return (
    <form
      aria-label={estado === "pagado" ? "Registrar venta pagada" : "Registrar trato hecho"}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        crear();
      }}
    >
      <h3 className="font-display text-base font-bold text-ink">
        {estado === "pagado" ? "Registrar venta pagada" : "Registrar trato hecho"}
      </h3>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-xs font-bold text-ink-secondary">Productos</legend>
        {renglones.length === 0 && <p className="text-sm text-ink-secondary">Buscá un producto de tu catálogo.</p>}
        {renglones.map((renglon) => (
          <label key={renglon.id} className="flex min-h-11 items-center gap-2.5 rounded-md border border-line px-3 text-sm">
            <span className="min-w-0 flex-1 truncate">{renglon.nombre}</span>
            <span className="sr-only">Cantidad de {renglon.nombre}</span>
            <input
              type="number"
              min={0}
              max={50}
              inputMode="numeric"
              value={renglon.cantidad}
              onChange={(e) => cambiarCantidad(renglon.id, Math.max(0, Math.min(50, Math.trunc(Number(e.target.value) || 0))))}
              className="h-9 w-16 rounded-sm border border-line-strong bg-card px-2 text-right text-ink"
            />
          </label>
        ))}
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Buscar otro producto</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void buscar();
                }
              }}
              placeholder="Agregar otro producto"
              className="h-11 w-full rounded-md border border-line-strong bg-card px-3 text-sm text-ink"
            />
          </label>
          <Button type="button" variant="secondary" onClick={() => void buscar()}>
            Buscar
          </Button>
        </div>
        {resultados && (
          <ul aria-label="Productos encontrados" className="flex flex-col gap-1">
            {resultados.length === 0 && <li className="text-sm text-ink-secondary">No encontramos productos con ese nombre.</li>}
            {resultados.map((producto) => (
              <li key={producto.id}>
                <button
                  type="button"
                  onClick={() => agregar(producto)}
                  className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 text-left text-sm hover:bg-sunken"
                >
                  <span className="truncate">{producto.nombre}</span>
                  <span className="flex-none font-semibold">{formatearMonto(producto.precioCentavos, producto.moneda)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <label className="flex flex-col gap-1.5 text-xs font-bold text-ink-secondary">
        Forma de pago
        <select
          value={forma}
          onChange={(e) => setForma(e.target.value)}
          className="h-11 rounded-md border border-line-strong bg-card px-3 text-sm font-normal text-ink"
        >
          <option value="contado">Contado (transferencia, link o como acuerden)</option>
          {hayEfectivo && <option value="efectivo">Efectivo, con su descuento</option>}
          {planes.map((cuotas) => (
            <option key={cuotas} value={`cuotas-${cuotas}`}>
              {cuotas} cuotas
            </option>
          ))}
        </select>
      </label>

      <p className="text-[13px] leading-[1.45] text-ink-secondary">
        El total sale de tus precios y promos de hoy, igual que cuando vende tu asistente.
        {estado === "pagado" && " Al guardarlo queda pagado, descuenta el stock y le avisamos al cliente."}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={trabajando || elegidos.length === 0}>
          {estado === "pagado" ? "Guardar venta pagada" : "Guardar trato hecho"}
        </Button>
        <Button type="button" variant="secondary" disabled={trabajando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
