"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FotoProducto } from "@/components/productos/FotoProducto";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  leerValorDescuento,
  problemaDeDescuento,
  vistaPrevia,
  type DescuentoAGuardar,
  type TipoDescuento,
} from "@/lib/descuentos";
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

/** Lo que se está tipeando en la sección Descuento. */
type DescuentoEnEdicion = {
  tiene: boolean;
  tipo: TipoDescuento;
  valor: string;
  desde: string;
  hasta: string;
  activo: boolean;
};

function descuentoDesdeProducto(producto: Producto | null): DescuentoEnEdicion {
  const d = producto?.descuento;
  if (!d) return { tiene: false, tipo: "porcentaje", valor: "", desde: "", hasta: "", activo: true };
  return {
    tiene: true,
    tipo: d.tipo,
    valor: d.tipo === "porcentaje" ? String(d.valor) : centavosParaInput(d.valor),
    desde: d.desde ?? "",
    hasta: d.hasta ?? "",
    activo: d.activo,
  };
}

/**
 * La sección Descuento → lo que se manda, null si no tiene, o el texto del
 * error. Mismas reglas que la API, para no gastar un viaje en un error obvio.
 */
function armarDescuento(
  descuento: DescuentoEnEdicion,
  variantes: ProductoAGuardar["variantes"],
): DescuentoAGuardar | null | string {
  if (!descuento.tiene) return null;
  const valor = leerValorDescuento(descuento.tipo, descuento.valor);
  const problema = problemaDeDescuento({ tipo: descuento.tipo, valor, desde: descuento.desde, hasta: descuento.hasta });
  if (problema || valor === null) return problema ?? "Revisá el descuento.";
  if (descuento.tipo === "monto" && variantes.every((v) => valor >= v.precioCentavos)) {
    return "El descuento no puede ser igual o mayor que el precio.";
  }
  return {
    tipo: descuento.tipo,
    valor,
    activo: descuento.activo,
    desde: descuento.desde || null,
    hasta: descuento.hasta || null,
  };
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
  onFotoCambiada,
}: {
  producto: Producto | null;
  onCerrar: () => void;
  onGuardado: (producto: Producto) => void;
  /** La foto se guarda sola (no espera al "Guardar"): avisa para refrescar el listado. */
  onFotoCambiada?: () => void;
}) {
  const titulo = useId();
  const idCampos = useId();
  const primerCampo = useRef<HTMLInputElement>(null);
  const [codigo, setCodigo] = useState(producto?.codigo ?? "");
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [categoria, setCategoria] = useState(producto?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(producto?.descripcion ?? "");
  const [variantes, setVariantes] = useState<VarianteEnEdicion[]>(
    producto ? desdeProducto(producto) : [nuevaVariante()],
  );
  const [descuento, setDescuento] = useState<DescuentoEnEdicion>(() => descuentoDesdeProducto(producto));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Foto del formulario al abrirlo, para saber si hay algo sin guardar.
  const formulario = JSON.stringify([
    codigo,
    nombre,
    categoria,
    descripcion,
    variantes.map((v) => [v.sku, v.nombre, v.precio, v.stock, v.stockMinimo, v.disponible]),
    descuento,
  ]);
  const [formularioInicial] = useState(formulario);
  const hayCambios = formulario !== formularioInicial;

  const cerrar = useCallback(() => {
    if (hayCambios && !window.confirm("Tenés cambios sin guardar. ¿Descartarlos?")) return;
    onCerrar();
  }, [hayCambios, onCerrar]);

  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  useEffect(() => {
    const alEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", alEscape);
    return () => document.removeEventListener("keydown", alEscape);
  }, [cerrar]);

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
    const descuentoArmado = armarDescuento(descuento, armadas);
    if (typeof descuentoArmado === "string") return descuentoArmado;
    return {
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      categoria: categoria.trim() || null,
      descripcion: descripcion.trim(),
      variantes: armadas,
      descuento: descuentoArmado,
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
        className="max-h-[92dvh] w-full max-w-[640px] overflow-y-auto rounded-t-lg bg-card p-5 shadow-md sm:rounded-lg lg:max-w-[980px]"
      >
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <h2 id={titulo} className="font-display text-[21px] font-bold text-ink">
            {producto ? "Editar producto" : "Nuevo producto"}
          </h2>

          {/* En pantallas grandes, dos columnas: datos y descuento a la izquierda, variantes a la derecha. */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
            <div className="flex flex-col gap-4">
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

              <FotoProducto
                productoId={producto?.id ?? null}
                imagenActualizada={producto?.imagenActualizada ?? null}
                onCambio={() => onFotoCambiada?.()}
              />

              <SeccionDescuento
                descuento={descuento}
                precios={variantes.map((v) => ({ clave: v.clave, nombre: v.nombre.trim(), centavos: leerCentavos(v.precio) }))}
                onCambio={(cambios) => setDescuento((actual) => ({ ...actual, ...cambios }))}
              />
            </div>

            <fieldset className="flex flex-col gap-3">
              <legend className={LABEL}>
                {variantes.length > 1 ? "Variantes (talle, color, sabor…)" : "Precio y stock"}
              </legend>
              {variantes.map((variante, indice) => {
                const id = (campo: string) => `${idCampos}-${variante.clave}-${campo}`;
                return (
                  <div key={variante.clave} className="grid gap-3 rounded-md bg-sunken p-3 sm:grid-cols-2">
                    {variantes.length > 1 && (
                      <div className="sm:col-span-2">
                        <label htmlFor={id("nombre")} className={LABEL}>
                          Nombre de la variante {indice + 1}
                        </label>
                        <input
                          id={id("nombre")}
                          value={variante.nombre}
                          placeholder='ej. "Talle M"'
                          maxLength={60}
                          onChange={(e) => cambiarVariante(variante.clave, { nombre: e.target.value })}
                          className={INPUT}
                        />
                      </div>
                    )}
                    <div>
                      <label htmlFor={id("precio")} className={LABEL}>
                        Precio
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-muted">$</span>
                        <input
                          id={id("precio")}
                          inputMode="decimal"
                          value={variante.precio}
                          placeholder="0"
                          onChange={(e) => cambiarVariante(variante.clave, { precio: e.target.value })}
                          className={INPUT}
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor={id("sku")} className={LABEL}>
                        Código interno (SKU) <span className="font-normal text-muted">(opcional)</span>
                      </label>
                      <input
                        id={id("sku")}
                        value={variante.sku}
                        maxLength={60}
                        onChange={(e) => cambiarVariante(variante.clave, { sku: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label htmlFor={id("stock")} className={LABEL}>
                        Stock (unidades)
                      </label>
                      <input
                        id={id("stock")}
                        inputMode="numeric"
                        value={variante.stock}
                        placeholder="Vacío = sin control de stock"
                        onChange={(e) => cambiarVariante(variante.clave, { stock: e.target.value })}
                        className={INPUT}
                      />
                    </div>
                    {variante.stock.trim() === "" ? (
                      // Sin cantidad cargada, la disponibilidad se marca a mano.
                      <div className="flex flex-col justify-end">
                        <span className={LABEL}>¿Está disponible?</span>
                        <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
                          <input
                            type="checkbox"
                            checked={variante.disponible}
                            onChange={(e) => cambiarVariante(variante.clave, { disponible: e.target.checked })}
                          />
                          Hay stock
                        </label>
                      </div>
                    ) : (
                      <div>
                        <label htmlFor={id("minimo")} className={LABEL}>
                          Avisarme cuando queden menos de <span className="font-normal text-muted">(unidades)</span>
                        </label>
                        <input
                          id={id("minimo")}
                          inputMode="numeric"
                          value={variante.stockMinimo}
                          placeholder="Opcional"
                          onChange={(e) => cambiarVariante(variante.clave, { stockMinimo: e.target.value })}
                          className={INPUT}
                        />
                      </div>
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
          </div>

          {/* Fija abajo del diálogo: con muchas variantes, guardar no obliga a bajar hasta el final.
              -bottom-5 la pega al borde (el sticky se mide desde adentro del padding del diálogo).
              El error va acá también, para que se vea al lado del botón que lo produjo. */}
          <div className="sticky -bottom-5 -mx-5 -mb-5 flex flex-col gap-2 border-t border-line bg-card px-5 py-3">
            {error && (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {hayCambios && (
                <p className="mr-auto basis-full text-[13px] font-semibold text-[var(--color-primitive-coral-700)] sm:basis-auto">
                  Cambios sin guardar
                </p>
              )}
              <Button variant="secondary" onClick={cerrar}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar producto"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

const SEGMENTO = "flex-1 cursor-pointer rounded-sm px-3 py-2 text-center text-[13.5px] font-semibold";

/**
 * El descuento propio del producto: porcentaje o monto fijo, vigencia
 * opcional y un switch para pausarlo, con la vista previa de lo que cobra el
 * asistente. Si además le toca una promo, la API aplica la que más le
 * conviene al cliente.
 */
function SeccionDescuento({
  descuento,
  precios,
  onCambio,
}: Readonly<{
  descuento: DescuentoEnEdicion;
  precios: Array<{ clave: string; nombre: string; centavos: number | null }>;
  onCambio: (cambios: Partial<DescuentoEnEdicion>) => void;
}>) {
  const valor = leerValorDescuento(descuento.tipo, descuento.valor);
  const previas =
    valor === null
      ? []
      : precios
          .flatMap((precio) => {
            const vista = precio.centavos === null ? null : vistaPrevia({ tipo: descuento.tipo, valor }, precio.centavos);
            return vista ? [{ ...vista, clave: precio.clave, nombre: precio.nombre }] : [];
          })
          .slice(0, 3);

  return (
    <fieldset
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        descuento.tiene ? "border-[var(--color-primitive-coral-200)] bg-primary-subtle" : "border-line",
      )}
    >
      <legend className="px-1 text-[13.5px] font-bold text-ink">Descuento</legend>
      <label className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <input
          type="checkbox"
          checked={descuento.tiene}
          onChange={(e) => onCambio({ tiene: e.target.checked })}
          className="size-4 accent-[var(--color-semantic-primary-default)]"
        />
        <span>Este producto tiene descuento</span>
      </label>

      {descuento.tiene && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px] sm:items-end">
            <div role="radiogroup" aria-label="Tipo de descuento">
              <span className={LABEL} aria-hidden="true">
                Tipo
              </span>
              <div className="flex gap-1 rounded-md border border-line bg-sunken p-1">
                {(
                  [
                    ["porcentaje", "Porcentaje"],
                    ["monto", "Monto fijo"],
                  ] as const
                ).map(([tipo, texto]) => (
                  <label
                    key={tipo}
                    className={cn(SEGMENTO, descuento.tipo === tipo ? "bg-card text-ink shadow-sm" : "text-ink-secondary")}
                  >
                    <input
                      type="radio"
                      name="tipo-descuento"
                      value={tipo}
                      checked={descuento.tipo === tipo}
                      onChange={() => onCambio({ tipo, valor: "" })}
                      className="sr-only"
                    />
                    {texto}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="descuento-valor" className={LABEL}>
                {descuento.tipo === "porcentaje" ? "Porcentaje" : "Monto"}
              </label>
              <div className="flex items-center gap-1.5">
                {descuento.tipo === "monto" && <span className="text-[13px] text-muted">$</span>}
                <input
                  id="descuento-valor"
                  inputMode={descuento.tipo === "porcentaje" ? "numeric" : "decimal"}
                  value={descuento.valor}
                  placeholder={descuento.tipo === "porcentaje" ? "20" : "500"}
                  onChange={(e) => onCambio({ valor: e.target.value })}
                  className={INPUT}
                />
                {descuento.tipo === "porcentaje" && <span className="text-[13px] text-muted">%</span>}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="descuento-desde" className={LABEL}>
                Desde <span className="font-normal text-muted">(opcional)</span>
              </label>
              <input
                id="descuento-desde"
                type="date"
                value={descuento.desde}
                onChange={(e) => onCambio({ desde: e.target.value })}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor="descuento-hasta" className={LABEL}>
                Hasta <span className="font-normal text-muted">(opcional, inclusive)</span>
              </label>
              <input
                id="descuento-hasta"
                type="date"
                value={descuento.hasta}
                min={descuento.desde || undefined}
                onChange={(e) => onCambio({ hasta: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 text-[14px] font-semibold text-ink">
            <span>Activo</span>
            <input
              type="checkbox"
              role="switch"
              checked={descuento.activo}
              onChange={(e) => onCambio({ activo: e.target.checked })}
              aria-label="Descuento activo"
              className="size-5 accent-[var(--color-semantic-primary-default)]"
            />
          </label>

          {previas.length > 0 && (
            <div className="rounded-md bg-card px-3 py-2.5">
              <p className="text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase">Así lo va a cobrar el asistente</p>
              <ul className="mt-1 flex flex-col gap-0.5 text-[14px] text-ink">
                {previas.map((previa) => (
                  <li key={previa.clave}>
                    {previa.nombre && <span className="text-ink-secondary">{previa.nombre}: </span>}
                    <span className="text-muted line-through">{previa.lista}</span> →{" "}
                    <strong className="text-[var(--color-primitive-coral-700)]">{previa.final}</strong>
                    <span className="text-ink-secondary"> · ahorra {previa.ahorro}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[12.5px] leading-[1.5] text-ink-secondary">
            Si también le toca una promoción general, el cliente paga la que más le conviene. Los descuentos no se suman.
          </p>
        </>
      )}
    </fieldset>
  );
}
