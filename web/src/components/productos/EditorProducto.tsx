"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  centavosParaInput,
  ErrorDeApi,
  guardarProducto,
  leerCentavos,
  type Producto,
  type ProductoAGuardar,
} from "@/lib/productos";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1.5 block text-[12.5px] font-semibold text-ink-secondary";

/** Tope de variantes por producto, el mismo MAX_VARIANTES de la API. */
const MAX_VARIANTES = 50;

type VarianteEnEdicion = {
  clave: string;
  sku: string;
  nombre: string;
  precio: string;
  stock: string;
  stockMinimo: string;
  disponible: boolean;
};

function nuevaVariante(): VarianteEnEdicion {
  return {
    clave: crypto.randomUUID(),
    sku: "",
    nombre: "",
    precio: "",
    stock: "",
    stockMinimo: "",
    disponible: true,
  };
}

function desdeProducto(producto: Producto): VarianteEnEdicion[] {
  return producto.variantes.map((variante) => ({
    clave: variante.id,
    sku: variante.sku,
    nombre: variante.nombre,
    precio: centavosParaInput(variante.precioCentavos),
    stock: variante.stock === null ? "" : String(variante.stock),
    stockMinimo: variante.stockMinimo === null ? "" : String(variante.stockMinimo),
    disponible: variante.disponible,
  }));
}

function entero(texto: string): number | null | "invalido" {
  const limpio = texto.trim();
  if (limpio === "") return null;
  return /^\d+$/.test(limpio) ? Number(limpio) : "invalido";
}

/** Alta o edición completa de un producto con sus variantes, en un diálogo. */
export function EditorProducto({
  producto,
  onCerrar,
  onGuardado,
}: {
  producto: Producto | null;
  onCerrar: () => void;
  onGuardado: (producto: Producto) => void;
}) {
  const titulo = useId();
  const primerCampo = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState(producto?.codigo ?? "");
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [categoria, setCategoria] = useState(producto?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? "");
  const [variantes, setVariantes] = useState<VarianteEnEdicion[]>(
    producto ? desdeProducto(producto) : [nuevaVariante()],
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    primerCampo.current?.focus();
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alEscape);
    return () => document.removeEventListener("keydown", alEscape);
  }, [onCerrar]);

  const cambiarVariante = (clave: string, cambios: Partial<VarianteEnEdicion>) =>
    setVariantes((actuales) => actuales.map((v) => (v.clave === clave ? { ...v, ...cambios } : v)));

  /** Valida en el navegador lo mismo que la API, para no gastar un viaje en un error obvio. */
  const armar = (): ProductoAGuardar | string => {
    if (!codigo.trim()) return "Poné un código para el producto.";
    if (nombre.trim().length < 2) return "Poné el nombre del producto.";
    const armadas: ProductoAGuardar["variantes"] = [];
    for (const [indice, variante] of variantes.entries()) {
      const cual = variantes.length > 1 ? ` de la variante ${indice + 1}` : "";
      const precioCentavos = leerCentavos(variante.precio);
      if (precioCentavos === null) return `Revisá el precio${cual}.`;
      const stock = entero(variante.stock);
      const stockMinimo = entero(variante.stockMinimo);
      if (stock === "invalido" || stockMinimo === "invalido") return `El stock${cual} tiene que ser un número entero.`;
      if (variantes.length > 1 && !variante.nombre.trim()) return `Poné el nombre de la variante ${indice + 1} (ej. "Talle M").`;
      armadas.push({
        ...(variante.sku.trim() ? { sku: variante.sku.trim() } : {}),
        nombre: variante.nombre.trim(),
        precioCentavos,
        stock,
        stockMinimo,
        disponible: variante.disponible,
      });
    }
    return {
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      categoria: categoria.trim() || null,
      descripcion: descripcion.trim(),
      variantes: armadas,
    };
  };

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    const datos = armar();
    if (typeof datos === "string") {
      setError(datos);
      return;
    }
    setGuardando(true);
    setError(null);
    guardarProducto(datos, producto?.id)
      .then(onGuardado)
      .catch((err: unknown) =>
        setError(err instanceof ErrorDeApi ? err.message : "No pudimos guardar el producto. Probá de nuevo."),
      )
      .finally(() => setGuardando(false));
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/30 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo}
        className="max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-t-lg bg-card p-5 shadow-md sm:rounded-lg"
      >
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <h2 id={titulo} className="font-display text-[21px] font-bold text-ink">
            {producto ? "Editar producto" : "Nuevo producto"}
          </h2>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <label htmlFor="producto-codigo" className={LABEL}>
                Código
              </label>
              <input
                id="producto-codigo"
                ref={primerCampo}
                value={codigo}
                maxLength={60}
                onChange={(e) => setCodigo(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="producto-nombre" className={LABEL}>
                Nombre
              </label>
              <input
                id="producto-nombre"
                value={nombre}
                maxLength={120}
                onChange={(e) => setNombre(e.target.value)}
                className={INPUT}
              />
            </div>
          </div>

          <div>
            <label htmlFor="producto-categoria" className={LABEL}>
              Categoría <span className="font-normal text-muted">(opcional)</span>
            </label>
            <input
              id="producto-categoria"
              value={categoria}
              maxLength={60}
              onChange={(e) => setCategoria(e.target.value)}
              className={INPUT}
            />
          </div>

          <div>
            <label htmlFor="producto-descripcion" className={LABEL}>
              Descripción breve <span className="font-normal text-muted">(la usa el asistente para recomendar)</span>
            </label>
            <textarea
              id="producto-descripcion"
              value={descripcion}
              maxLength={500}
              rows={3}
              onChange={(e) => setDescripcion(e.target.value)}
              className={INPUT}
            />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className={LABEL}>
              {variantes.length > 1 ? "Variantes (talle, color, sabor…)" : "Precio y stock"}
            </legend>
            {variantes.map((variante, indice) => {
              const n = variantes.length > 1 ? ` de la variante ${indice + 1}` : "";
              return (
                <div key={variante.clave} className="grid gap-2 rounded-md bg-sunken p-3 sm:grid-cols-2">
                  {variantes.length > 1 && (
                    <input
                      value={variante.nombre}
                      placeholder='Variante, ej. "Talle M"'
                      maxLength={60}
                      aria-label={`Nombre${n}`}
                      onChange={(e) => cambiarVariante(variante.clave, { nombre: e.target.value })}
                      className={`${INPUT} sm:col-span-2`}
                    />
                  )}
                  <label className="flex items-center gap-2">
                    <span className="text-[13px] text-muted">$</span>
                    <input
                      inputMode="decimal"
                      value={variante.precio}
                      placeholder="Precio"
                      aria-label={`Precio${n}`}
                      onChange={(e) => cambiarVariante(variante.clave, { precio: e.target.value })}
                      className={INPUT}
                    />
                  </label>
                  <input
                    value={variante.sku}
                    placeholder="SKU (opcional)"
                    maxLength={60}
                    aria-label={`SKU${n}`}
                    onChange={(e) => cambiarVariante(variante.clave, { sku: e.target.value })}
                    className={INPUT}
                  />
                  <input
                    inputMode="numeric"
                    value={variante.stock}
                    placeholder="Stock (vacío = sin control)"
                    aria-label={`Stock${n}`}
                    onChange={(e) => cambiarVariante(variante.clave, { stock: e.target.value })}
                    className={INPUT}
                  />
                  {variante.stock.trim() === "" ? (
                    <label className="flex items-center gap-2 text-[13.5px] text-ink">
                      <input
                        type="checkbox"
                        checked={variante.disponible}
                        onChange={(e) => cambiarVariante(variante.clave, { disponible: e.target.checked })}
                      />
                      Hay stock
                    </label>
                  ) : (
                    <input
                      inputMode="numeric"
                      value={variante.stockMinimo}
                      placeholder="Avisarme con menos de…"
                      aria-label={`Stock mínimo${n}`}
                      onChange={(e) => cambiarVariante(variante.clave, { stockMinimo: e.target.value })}
                      className={INPUT}
                    />
                  )}
                  {variantes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setVariantes((actuales) => actuales.filter((v) => v.clave !== variante.clave))}
                      className="cursor-pointer text-left text-[12.5px] text-danger-text sm:col-span-2"
                    >
                      Quitar esta variante
                    </button>
                  )}
                </div>
              );
            })}
            {variantes.length < MAX_VARIANTES && (
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => setVariantes((actuales) => [...actuales, nuevaVariante()])}
              >
                Agregar variante
              </Button>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar producto"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
