"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { descripcionDescuento, origenDescuento } from "@/lib/descuentos";
import {
  actualizarVariante,
  centavosParaInput,
  etiquetaStock,
  formatearCentavos,
  leerCentavos,
  type Producto,
  type Variante,
} from "@/lib/productos";

const ETIQUETA = "text-[11.5px] font-semibold text-muted";
const INPUT_CHICO =
  "w-full rounded-sm border bg-card px-2 py-1.5 text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken";

/** Cuánto queda a la vista el "Guardado" después de guardar. */
const MS_AVISO_GUARDADO = 3000;

/** Lo que el dueño está tipeando en una variante, todavía sin guardar. */
type Borrador = { precio: string; stock: string; disponible: boolean };

type CambiosDeVariante = Parameters<typeof actualizarVariante>[1];

function borradorDe(variante: Variante): Borrador {
  return {
    precio: centavosParaInput(variante.precioCentavos),
    stock: variante.stock === null ? "" : String(variante.stock),
    disponible: variante.disponible,
  };
}

function borradoresDe(producto: Producto): Record<string, Borrador> {
  return Object.fromEntries(producto.variantes.map((v) => [v.id, borradorDe(v)]));
}

/** Cambia cuando cambia algo de lo que se edita en la tarjeta (el PATCH de variante no toca `updatedAt`). */
function firmaDe(producto: Producto): string {
  return JSON.stringify([
    producto.updatedAt,
    producto.variantes.map((v) => [v.id, v.precioCentavos, v.stock, v.disponible]),
  ]);
}

/** El stock tipeado: null = sin control, "invalido" si no es un entero. */
function leerStock(texto: string): number | null | "invalido" {
  const limpio = texto.trim();
  if (limpio === "") return null;
  return /^\d+$/.test(limpio) ? Number(limpio) : "invalido";
}

/**
 * Qué cambió en una variante respecto de lo guardado. Un precio o stock mal
 * tipeado cuenta como cambio (hay algo por corregir antes de guardar).
 */
function analizar(variante: Variante, borrador: Borrador) {
  const centavos = leerCentavos(borrador.precio);
  const stock = leerStock(borrador.stock);
  const cambios: CambiosDeVariante = {};
  if (centavos !== null && centavos !== variante.precioCentavos) cambios.precioCentavos = centavos;
  if (stock !== "invalido" && stock !== variante.stock) cambios.stock = stock;
  // "Hay / Sin stock" sólo vale cuando no se controla cantidad.
  if (stock === null && borrador.disponible !== variante.disponible) cambios.disponible = borrador.disponible;
  const precioEditado = centavos === null || centavos !== variante.precioCentavos;
  const stockEditado = stock === "invalido" || stock !== variante.stock;
  const error = centavos === null ? "Precio inválido." : stock === "invalido" ? "El stock es un número entero." : null;
  return {
    cambios,
    error,
    precioEditado,
    stockEditado,
    editada: precioEditado || stockEditado || "disponible" in cambios,
    // Lo que muestra el badge mientras se edita: lo tipeado si se entiende, si no lo guardado.
    vista: {
      stock: stock === "invalido" ? variante.stock : stock,
      disponible: borrador.disponible,
      stockMinimo: variante.stockMinimo,
    },
  };
}

/**
 * Una tarjeta del catálogo: datos del producto y edición rápida de precio y
 * stock por variante. Lo que se tipea queda pendiente hasta "Guardar cambios".
 */
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
  const [borradores, setBorradores] = useState(() => borradoresDe(producto));
  const [firma, setFirma] = useState(() => firmaDe(producto));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  // Si el producto cambió afuera (se guardó, se editó en el diálogo, se
  // importó), el borrador vuelve a lo guardado.
  const firmaActual = firmaDe(producto);
  if (firmaActual !== firma) {
    setFirma(firmaActual);
    setBorradores(borradoresDe(producto));
  }

  useEffect(() => {
    if (!guardado) return;
    const timer = setTimeout(() => setGuardado(false), MS_AVISO_GUARDADO);
    return () => clearTimeout(timer);
  }, [guardado]);

  const analisis = producto.variantes.map((variante) => ({
    variante,
    borrador: borradores[variante.id] ?? borradorDe(variante),
    ...analizar(variante, borradores[variante.id] ?? borradorDe(variante)),
  }));
  const hayCambios = analisis.some((a) => a.editada);

  const cambiar = (id: string, cambios: Partial<Borrador>) => {
    setGuardado(false);
    setError(null);
    setBorradores((actuales) => ({ ...actuales, [id]: { ...actuales[id], ...cambios } }));
  };

  const descartar = () => {
    setBorradores(borradoresDe(producto));
    setError(null);
  };

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando || !hayCambios) return;
    const conError = analisis.find((a) => a.error);
    if (conError) {
      const unica = producto.variantes.length === 1 && conError.variante.nombre === "";
      setError(unica ? conError.error : `${conError.variante.nombre}: ${conError.error}`);
      return;
    }
    const pendientes = analisis.filter((a) => Object.keys(a.cambios).length > 0);
    if (pendientes.length === 0) {
      // Sólo cambió el formato ("15000" en vez de "15.000"): nada que mandar.
      descartar();
      return;
    }
    setGuardando(true);
    setError(null);
    // Uno por variante y en orden: el último trae el producto con todo aplicado.
    pendientes
      .reduce<Promise<Producto | null>>(
        (anterior, a) => anterior.then(() => actualizarVariante(a.variante.id, a.cambios)),
        Promise.resolve(null),
      )
      .then((actualizado) => {
        if (actualizado) onCambio(actualizado);
        setGuardado(true);
      })
      .catch(() => setError("No se pudo guardar. Probá de nuevo."))
      .finally(() => setGuardando(false));
  };

  // El descuento que hoy aplica (el mismo para todas las variantes, salvo un monto
  // fijo que no entra en alguna): el de la primera variante que tenga.
  const aplicado = producto.variantes.find((v) => v.descuento)?.descuento ?? null;
  const propioInactivo = !aplicado && producto.descuento;

  return (
    <li
      className={cn(
        "@container flex min-w-0 flex-col rounded-lg border bg-card p-4 transition-colors",
        hayCambios ? "border-[var(--color-primitive-coral-200)]" : "border-line",
      )}
    >
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

      {aplicado ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone="primary">{descripcionDescuento(aplicado)}</Badge>
          <span className="text-[12px] text-muted">{origenDescuento(aplicado)}</span>
        </div>
      ) : (
        propioInactivo && (
          <div className="mt-2">
            <Badge tone="neutral">Descuento {producto.descuento?.activo ? "fuera de fecha" : "pausado"}</Badge>
          </div>
        )
      )}

      <form onSubmit={guardar} aria-label={`Precio y stock de ${producto.nombre}`}>
        <ul className="mt-3 flex flex-col gap-2">
          {analisis.map((a) => (
            <FilaVariante
              key={a.variante.id}
              variante={a.variante}
              borrador={a.borrador}
              nombreProducto={producto.nombre}
              unica={producto.variantes.length === 1 && a.variante.nombre === ""}
              editada={a.editada}
              precioEditado={a.precioEditado}
              stockEditado={a.stockEditado}
              estado={etiquetaStock(a.vista)}
              sinControl={a.vista.stock === null}
              deshabilitada={guardando}
              onCambio={(cambios) => cambiar(a.variante.id, cambios)}
            />
          ))}
        </ul>

        {hayCambios ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <p className="flex-1 text-[13px] font-semibold text-[var(--color-primitive-coral-700)]">
              Cambios sin guardar
            </p>
            <Button variant="secondary" size="sm" disabled={guardando} onClick={descartar}>
              Descartar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={guardando}
              aria-label={`Guardar cambios de ${producto.nombre}`}
            >
              {guardando ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        ) : (
          guardado && (
            <p role="status" className="mt-3 text-[13px] font-semibold text-success-text">
              ✓ Guardado
            </p>
          )
        )}

        {error && (
          <p role="alert" className="mt-2 text-[12px] text-danger-text">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}

function FilaVariante({
  variante,
  borrador,
  nombreProducto,
  unica,
  editada,
  precioEditado,
  stockEditado,
  estado,
  sinControl,
  deshabilitada,
  onCambio,
}: {
  variante: Variante;
  borrador: Borrador;
  nombreProducto: string;
  unica: boolean;
  editada: boolean;
  precioEditado: boolean;
  stockEditado: boolean;
  estado: ReturnType<typeof etiquetaStock>;
  sinControl: boolean;
  deshabilitada: boolean;
  onCambio: (cambios: Partial<Borrador>) => void;
}) {
  const etiqueta = unica ? nombreProducto : `${nombreProducto} ${variante.nombre}`;
  // El final que muestra es el guardado: mientras se edita el precio no se sabe todavía.
  const final = variante.descuento && !precioEditado ? variante.precioFinalCentavos : null;
  const borde = (editado: boolean) =>
    editado ? "border-primary ring-1 ring-[var(--color-semantic-border-focus)]" : "border-line";

  return (
    <li
      className={cn(
        "grid grid-cols-2 items-end gap-x-3 gap-y-2 rounded-md px-3 py-2 @md:grid-cols-[1fr_120px_120px_76px]",
        editada ? "bg-[var(--color-primitive-coral-50)]" : "bg-sunken",
      )}
    >
      <div className="order-1 min-w-0">
        <p className="truncate text-[13.5px] text-ink">
          {unica ? "Única" : variante.nombre}
          {editada && (
            <span className="ml-1.5 text-[11px] font-bold text-[var(--color-primitive-coral-700)]">· Editado</span>
          )}
        </p>
        <p className="truncate text-[11.5px] text-muted">SKU {variante.sku}</p>
      </div>

      {/* En una tarjeta angosta: nombre y estado arriba, precio y stock abajo, cada uno con su etiqueta. */}
      <label className="order-3 flex flex-col gap-1 @md:order-2">
        <span className={ETIQUETA}>Precio</span>
        <span className="flex items-center gap-1">
          <span className="text-[13px] text-muted">$</span>
          <input
            inputMode="decimal"
            value={borrador.precio}
            disabled={deshabilitada}
            onChange={(e) => onCambio({ precio: e.target.value })}
            aria-label={`Precio de ${etiqueta}`}
            className={cn(INPUT_CHICO, borde(precioEditado))}
          />
        </span>
      </label>

      <label className="order-4 flex flex-col gap-1 @md:order-3">
        <span className={ETIQUETA}>Stock (unidades)</span>
        <input
          inputMode="numeric"
          value={borrador.stock}
          placeholder="Sin control"
          disabled={deshabilitada}
          onChange={(e) => onCambio({ stock: e.target.value })}
          aria-label={`Stock de ${etiqueta}`}
          className={cn(INPUT_CHICO, borde(stockEditado))}
        />
      </label>

      {/* La cantidad ya está en el campo: el badge sólo aparece cuando dice algo más (sin stock, stock bajo, o el "Hay" que se toca). */}
      <div className="order-2 flex items-center justify-end gap-2 self-center @md:order-4 @md:min-h-[34px] @md:self-end">
        {sinControl ? (
          <button
            type="button"
            disabled={deshabilitada}
            onClick={() => onCambio({ disponible: !borrador.disponible })}
            aria-pressed={borrador.disponible}
            aria-label={`${etiqueta}: ${borrador.disponible ? "hay stock" : "sin stock"}`}
            className="cursor-pointer"
          >
            <Badge tone={estado.tono}>{estado.texto}</Badge>
          </button>
        ) : (
          estado.tono !== "success" && <Badge tone={estado.tono}>{estado.texto}</Badge>
        )}
      </div>

      {final !== null && (
        <p className="order-5 col-span-2 text-[12.5px] font-bold text-[var(--color-primitive-coral-700)] @md:col-span-4">
          Final {formatearCentavos(final)}{" "}
          <span className="font-medium text-muted line-through">{formatearCentavos(variante.precioCentavos)}</span>
        </p>
      )}
    </li>
  );
}
