"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  actualizarVariante,
  centavosParaInput,
  etiquetaStock,
  leerCentavos,
  type Producto,
  type Variante,
} from "@/lib/productos";

const INPUT_CHICO =
  "w-full rounded-sm border border-line bg-card px-2 py-1.5 text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken";

/** Una tarjeta del catálogo: datos del producto y edición rápida de precio y stock por variante. */
export function FilaProducto({
  producto,
  onCambio,
  onEditar,
  onBorrar,
}: {
  producto: Producto;
  onCambio: (producto: Producto) => void;
  onEditar: () => void;
  onBorrar: () => void;
}) {
  return (
    <li className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{producto.nombre}</p>
          <p className="text-[12.5px] text-muted">
            {producto.codigo}
            {producto.categoria ? ` · ${producto.categoria}` : ""}
            {!producto.indexado && " · indexando para el asistente…"}
          </p>
          {producto.descripcion && (
            <p className="mt-1 line-clamp-2 text-[13px] text-ink-secondary">{producto.descripcion}</p>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEditar} aria-label={`Editar ${producto.nombre}`}>
            Editar
          </Button>
          <Button variant="ghost" size="sm" onClick={onBorrar} aria-label={`Borrar ${producto.nombre}`}>
            Borrar
          </Button>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mt-3 hidden grid-cols-[1fr_130px_110px_auto] gap-x-3 px-3 text-[11.5px] font-semibold text-muted sm:grid"
      >
        <span>Variante</span>
        <span>Precio</span>
        <span>Stock</span>
        <span className="w-16" />
      </div>
      <ul className="mt-1.5 flex flex-col gap-2">
        {producto.variantes.map((variante) => (
          <FilaVariante
            key={variante.id}
            variante={variante}
            nombreProducto={producto.nombre}
            unica={producto.variantes.length === 1 && variante.nombre === ""}
            onCambio={onCambio}
          />
        ))}
      </ul>
    </li>
  );
}

function FilaVariante({
  variante,
  nombreProducto,
  unica,
  onCambio,
}: {
  variante: Variante;
  nombreProducto: string;
  unica: boolean;
  onCambio: (producto: Producto) => void;
}) {
  const etiqueta = unica ? nombreProducto : `${nombreProducto} ${variante.nombre}`;
  const [precio, setPrecio] = useState(centavosParaInput(variante.precioCentavos));
  const [stock, setStock] = useState(variante.stock === null ? "" : String(variante.stock));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estado = etiquetaStock(variante);

  const guardar = (cambios: Parameters<typeof actualizarVariante>[1]) => {
    setGuardando(true);
    setError(null);
    actualizarVariante(variante.id, cambios)
      .then(onCambio)
      .catch(() => setError("No se pudo guardar."))
      .finally(() => setGuardando(false));
  };

  const confirmarPrecio = () => {
    const centavos = leerCentavos(precio);
    if (centavos === null) {
      setError("Precio inválido.");
      return;
    }
    if (centavos !== variante.precioCentavos) guardar({ precioCentavos: centavos });
  };

  const confirmarStock = () => {
    const limpio = stock.trim();
    if (limpio === "") {
      if (variante.stock !== null) guardar({ stock: null });
      return;
    }
    if (!/^\d+$/.test(limpio)) {
      setError("El stock es un número entero.");
      return;
    }
    if (Number(limpio) !== variante.stock) guardar({ stock: Number(limpio) });
  };

  const alEnter = (confirmar: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") confirmar();
  };

  return (
    <li className="grid grid-cols-2 items-center gap-x-3 gap-y-2 rounded-md bg-sunken px-3 py-2 sm:grid-cols-[1fr_130px_110px_auto]">
      <div className="order-1 min-w-0">
        <p className="truncate text-[13.5px] text-ink">{unica ? "Única" : variante.nombre}</p>
        <p className="truncate text-[11.5px] text-muted">SKU {variante.sku}</p>
      </div>

      {/* En el celular: nombre y estado arriba, precio y stock abajo. */}
      <label className="order-3 flex items-center gap-1 sm:order-2">
        <span className="text-[13px] text-muted">$</span>
        <input
          inputMode="decimal"
          value={precio}
          disabled={guardando}
          onChange={(e) => setPrecio(e.target.value)}
          onBlur={confirmarPrecio}
          onKeyDown={alEnter(confirmarPrecio)}
          aria-label={`Precio de ${etiqueta}`}
          className={INPUT_CHICO}
        />
      </label>

      <label className="order-4 flex items-center gap-1 sm:order-3">
        <input
          inputMode="numeric"
          value={stock}
          placeholder="Sin control"
          disabled={guardando}
          onChange={(e) => setStock(e.target.value)}
          onBlur={confirmarStock}
          onKeyDown={alEnter(confirmarStock)}
          aria-label={`Stock de ${etiqueta}`}
          className={INPUT_CHICO}
        />
        <span className="text-[12px] text-muted sm:hidden">u.</span>
      </label>

      <div className="order-2 flex items-center justify-end gap-2 sm:order-4">
        {variante.stock === null ? (
          <button
            type="button"
            disabled={guardando}
            onClick={() => guardar({ disponible: !variante.disponible })}
            aria-pressed={variante.disponible}
            aria-label={`${etiqueta}: ${variante.disponible ? "hay stock" : "sin stock"}`}
            className="cursor-pointer"
          >
            <Badge tone={estado.tono}>{estado.texto}</Badge>
          </button>
        ) : (
          <Badge tone={estado.tono}>{estado.texto}</Badge>
        )}
      </div>

      {error && (
        <p role="alert" className="order-5 col-span-full text-[12px] text-danger-text">
          {error}
        </p>
      )}
    </li>
  );
}
