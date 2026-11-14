"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { descripcionDescuento, origenDescuento } from "@/lib/descuentos";
import { urlImagenProducto } from "@/lib/imagenes";
import {
  actualizarStock,
  centavosParaInput,
  etiquetaStock,
  formatearMonto,
  leerCentavos,
  type Producto,
} from "@/lib/productos";
import { CampoNumero } from "@/components/ui/CampoNumero";
import { leerEntero } from "@/lib/numeros";

const ETIQUETA = "text-[11.5px] font-semibold text-muted";
const INPUT_CHICO =
  "w-full rounded-sm border bg-card px-2 py-1.5 text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken";

/** Cuánto queda a la vista el "Guardado" después de guardar. */
const MS_AVISO_GUARDADO = 3000;

/** Lo que el dueño está tipeando, todavía sin guardar. */
type Borrador = { precio: string; stock: string; disponible: boolean };

type CambiosDeStock = Parameters<typeof actualizarStock>[1];

function borradorDe(producto: Producto): Borrador {
  return {
    precio: centavosParaInput(producto.precioCentavos),
    stock: producto.stock === null ? "" : String(producto.stock),
    disponible: producto.disponible,
  };
}

/** Cambia cuando cambia algo de lo que se edita en la tarjeta. */
function firmaDe(producto: Producto): string {
  return JSON.stringify([producto.updatedAt, producto.precioCentavos, producto.stock, producto.disponible]);
}

/** El stock tipeado: null = sin control, "invalido" si no es un entero. */
const leerStock = (texto: string) => leerEntero(texto);

/**
 * Qué cambió respecto de lo guardado. Un precio o stock mal tipeado cuenta
 * como cambio (hay algo por corregir antes de guardar).
 */
function analizar(producto: Producto, borrador: Borrador) {
  const centavos = leerCentavos(borrador.precio);
  const stock = leerStock(borrador.stock);
  const cambios: CambiosDeStock = {};
  if (centavos !== null && centavos !== producto.precioCentavos) cambios.precioCentavos = centavos;
  if (stock !== "invalido" && stock !== producto.stock) cambios.stock = stock;
  // "Hay / Sin stock" sólo vale cuando no se controla cantidad.
  if (stock === null && borrador.disponible !== producto.disponible) cambios.disponible = borrador.disponible;
  const precioEditado = centavos === null || centavos !== producto.precioCentavos;
  const stockEditado = stock === "invalido" || stock !== producto.stock;
  const error = centavos === null ? "Precio inválido." : stock === "invalido" ? "El stock es un número entero." : null;
  return {
    cambios,
    error,
    precioEditado,
    stockEditado,
    editada: precioEditado || stockEditado || "disponible" in cambios,
    // Lo que muestra el badge mientras se edita: lo tipeado si se entiende, si no lo guardado.
    vista: {
      stock: stock === "invalido" ? producto.stock : stock,
      disponible: borrador.disponible,
      stockMinimo: producto.stockMinimo,
    },
  };
}

/**
 * Una tarjeta del catálogo: datos del producto y edición rápida de precio y
 * stock. Lo que se tipea queda pendiente hasta "Guardar cambios".
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
  const [borrador, setBorrador] = useState(() => borradorDe(producto));
  const [firma, setFirma] = useState(() => firmaDe(producto));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  // Si el producto cambió afuera (se guardó, se editó en su pantalla, se
  // importó), el borrador vuelve a lo guardado.
  const firmaActual = firmaDe(producto);
  if (firmaActual !== firma) {
    setFirma(firmaActual);
    setBorrador(borradorDe(producto));
  }

  useEffect(() => {
    if (!guardado) return;
    const timer = setTimeout(() => setGuardado(false), MS_AVISO_GUARDADO);
    return () => clearTimeout(timer);
  }, [guardado]);

  const analisis = analizar(producto, borrador);
  const hayCambios = analisis.editada;

  const cambiar = (cambios: Partial<Borrador>) => {
    setGuardado(false);
    setError(null);
    setBorrador((actual) => ({ ...actual, ...cambios }));
  };

  const descartar = () => {
    setBorrador(borradorDe(producto));
    setError(null);
  };

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando || !hayCambios) return;
    if (analisis.error) {
      setError(analisis.error);
      return;
    }
    if (Object.keys(analisis.cambios).length === 0) {
      // Sólo cambió el formato ("15000" en vez de "15.000"): nada que mandar.
      descartar();
      return;
    }
    setGuardando(true);
    setError(null);
    actualizarStock(producto.id, analisis.cambios)
      .then((actualizado) => {
        onCambio(actualizado);
        setGuardado(true);
      })
      .catch(() => setError("No se pudo guardar. Probá de nuevo."))
      .finally(() => setGuardando(false));
  };

  const aplicado = producto.descuentoAplicado;
  const propioInactivo = !aplicado && producto.descuento;

  return (
    <li
      className={cn(
        "@container flex min-w-0 flex-col rounded-lg border bg-card p-4 transition-colors",
        hayCambios ? "border-[var(--color-primitive-coral-200)]" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {producto.imagenActualizada && (
          // eslint-disable-next-line @next/next/no-img-element -- viene de la API con la cookie de sesión; el optimizador de Next no la tiene
          <img
            src={urlImagenProducto(producto.id, producto.imagenActualizada)}
            alt={`Foto de ${producto.nombre}`}
            loading="lazy"
            className="size-12 shrink-0 rounded-md bg-sunken object-cover"
          />
        )}
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
        <PrecioYStock
          producto={producto}
          borrador={borrador}
          editada={analisis.editada}
          precioEditado={analisis.precioEditado}
          stockEditado={analisis.stockEditado}
          estado={etiquetaStock(analisis.vista)}
          sinControl={analisis.vista.stock === null}
          deshabilitada={guardando}
          onCambio={cambiar}
        />

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

function PrecioYStock({
  producto,
  borrador,
  editada,
  precioEditado,
  stockEditado,
  estado,
  sinControl,
  deshabilitada,
  onCambio,
}: {
  producto: Producto;
  borrador: Borrador;
  editada: boolean;
  precioEditado: boolean;
  stockEditado: boolean;
  estado: ReturnType<typeof etiquetaStock>;
  sinControl: boolean;
  deshabilitada: boolean;
  onCambio: (cambios: Partial<Borrador>) => void;
}) {
  const { nombre, moneda } = producto;
  // El final que muestra es el guardado: mientras se edita el precio no se sabe todavía.
  const final = producto.descuentoAplicado && !precioEditado ? producto.precioFinalCentavos : null;
  const borde = (editado: boolean) =>
    editado ? "border-primary ring-1 ring-[var(--color-semantic-border-focus)]" : "border-line";

  return (
    <div
      className={cn(
        "mt-3 grid grid-cols-2 items-end gap-x-3 gap-y-2 rounded-md px-3 py-2 @md:grid-cols-[120px_120px_1fr]",
        editada ? "bg-[var(--color-primitive-coral-50)]" : "bg-sunken",
      )}
    >
      <label className="flex flex-col gap-1">
        <span className={ETIQUETA}>
          Precio
          {editada && <span className="ml-1.5 text-[11px] font-bold text-[var(--color-primitive-coral-700)]">· Editado</span>}
        </span>
        <span className="flex items-center gap-1">
          <span className="text-[13px] text-muted">{moneda === "USD" ? "US$" : "$"}</span>
          <CampoNumero
            decimales
            value={borrador.precio}
            disabled={deshabilitada}
            onValueChange={(precio) => onCambio({ precio })}
            aria-label={`Precio de ${nombre}`}
            className={cn(INPUT_CHICO, borde(precioEditado))}
          />
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={ETIQUETA}>Stock (unidades)</span>
        <CampoNumero
          value={borrador.stock}
          placeholder="Sin control"
          disabled={deshabilitada}
          onValueChange={(stock) => onCambio({ stock })}
          aria-label={`Stock de ${nombre}`}
          className={cn(INPUT_CHICO, borde(stockEditado))}
        />
      </label>

      {/* La cantidad ya está en el campo: el badge sólo aparece cuando dice algo más (sin stock, stock bajo, o el "Hay" que se toca). */}
      <div className="col-span-2 flex items-center justify-end gap-2 @md:col-span-1 @md:min-h-[34px]">
        {sinControl ? (
          <button
            type="button"
            disabled={deshabilitada}
            onClick={() => onCambio({ disponible: !borrador.disponible })}
            aria-pressed={borrador.disponible}
            aria-label={`${nombre}: ${borrador.disponible ? "hay stock" : "sin stock"}`}
            className="cursor-pointer"
          >
            <Badge tone={estado.tono}>{estado.texto}</Badge>
          </button>
        ) : (
          estado.tono !== "success" && <Badge tone={estado.tono}>{estado.texto}</Badge>
        )}
      </div>

      {final !== null && (
        <p className="col-span-2 text-[12.5px] font-bold text-[var(--color-primitive-coral-700)] @md:col-span-3">
          Final {formatearMonto(final, moneda)}{" "}
          <span className="font-medium text-muted line-through">{formatearMonto(producto.precioCentavos, moneda)}</span>
        </p>
      )}
    </div>
  );
}
