"use client";

import { useId } from "react";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  EXPLICACION_AVISO,
  MAX_VERSIONES,
  NOMBRE_FUENTE,
  problemaDelProducto,
  type ProductoEnRevision,
  type TipoImportado,
} from "@/lib/importacion";
import { MONEDAS, NOMBRE_MONEDA } from "@/lib/productos";

const SEGMENTO = "relative flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-center text-[13px] font-semibold";

const TIPOS: Array<{ valor: TipoImportado; texto: string; detalle: string }> = [
  { valor: "stock", texto: "De stock", detalle: "Precio fijo, sin cambios" },
  { valor: "a_medida", texto: "A medida", detalle: "Se cotiza según lo que pida el cliente" },
];

/**
 * Un producto encontrado en un enlace, para revisar antes de importarlo: se
 * tilda, se corrige lo que haga falta y se elige la foto. Lo que la página no
 * decía (el precio, la moneda) queda vacío y frena la importación hasta que
 * el dueño lo carga: nada se inventa. Sin precio, primero se pregunta si es
 * de stock o a medida, y se muestran los campos de ese tipo; lo que no entra
 * acá (las preguntas al cliente, la cotización) se completa en el editor.
 */
export function TarjetaBorrador({
  producto,
  onCambio,
}: Readonly<{
  producto: ProductoEnRevision;
  onCambio: (cambios: Partial<ProductoEnRevision>) => void;
}>) {
  const id = useId();
  const { borrador } = producto;
  const problema = producto.elegido ? problemaDelProducto(producto) : null;
  const simbolo = producto.moneda === "USD" ? "US$" : "$";
  const cambiarVariante = (clave: string, cambios: Partial<ProductoEnRevision["variantes"][number]>) =>
    onCambio({ variantes: producto.variantes.map((v) => (v.clave === clave ? { ...v, ...cambios } : v)) });
  const cambiarVersion = (clave: string, cambios: Partial<ProductoEnRevision["versiones"][number]>) =>
    onCambio({ versiones: producto.versiones.map((v) => (v.clave === clave ? { ...v, ...cambios } : v)) });
  const sinPrecio = borrador.variantes.some((variante) => variante.precioCentavos === null);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4",
        producto.elegido ? (problema ? "border-warning" : "border-line") : "border-dashed border-line opacity-80",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={producto.elegido}
            onChange={(e) => onCambio({ elegido: e.target.checked })}
            className="mt-1 size-4 accent-[var(--color-semantic-primary-default)]"
            aria-label={`Importar ${producto.nombre || "este producto"}`}
          />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{producto.nombre || "Sin nombre"}</span>
            <a
              href={borrador.origenUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block truncate text-[12.5px] text-[var(--color-semantic-text-link)] hover:underline"
            >
              {NOMBRE_FUENTE[borrador.fuente]} · {new URL(borrador.origenUrl).hostname}
            </a>
          </span>
        </label>
        {borrador.duplicado && <Badge tone="warning">Ya lo tenés</Badge>}
      </div>

      {borrador.duplicado && (
        <div className="rounded-md bg-warning-subtle px-3 py-2 text-[13px] text-ink-secondary">
          {borrador.duplicado.motivo === "origen"
            ? "Ya importaste este enlace"
            : borrador.duplicado.motivo === "codigo"
              ? "Ya tenés un producto con este código"
              : "Ya tenés un producto con el mismo SKU"}
          : <strong className="text-ink">{borrador.duplicado.nombre}</strong>. Por defecto no se importa.
          {producto.elegido && (
            <label className="mt-1.5 flex items-center gap-2 font-semibold text-ink">
              <input
                type="checkbox"
                checked={producto.actualizar}
                onChange={(e) => onCambio({ actualizar: e.target.checked })}
                className="size-4 accent-[var(--color-semantic-primary-default)]"
              />
              Actualizar el que ya tengo con estos datos
            </label>
          )}
        </div>
      )}

      {producto.elegido && (
        <>
          {borrador.avisos.length > 0 && (
            <ul className="flex flex-col gap-1 text-[12.5px] text-ink-secondary">
              {borrador.avisos.map((aviso) => (
                <li key={aviso}>· {EXPLICACION_AVISO[aviso]}</li>
              ))}
            </ul>
          )}

          <div
            role="radiogroup"
            aria-label={`Cómo vendés ${producto.nombre || "este producto"}`}
            className={cn("rounded-md p-3", producto.tipo ? "bg-sunken" : "border border-warning bg-warning-subtle")}
          >
            <span className={LABEL} aria-hidden="true">
              {sinPrecio ? "No encontramos el precio: ¿cómo lo vendés?" : "¿Cómo lo vendés?"}
            </span>
            <div className="flex gap-1 rounded-md border border-line bg-card p-1">
              {TIPOS.map((opcion) => (
                <label
                  key={opcion.valor}
                  className={cn(SEGMENTO, producto.tipo === opcion.valor ? "bg-primary-subtle text-ink shadow-sm" : "text-ink-secondary")}
                >
                  <input
                    type="radio"
                    name={`${id}-tipo`}
                    value={opcion.valor}
                    checked={producto.tipo === opcion.valor}
                    onChange={() => onCambio({ tipo: opcion.valor })}
                    className="sr-only"
                  />
                  {opcion.texto}
                  <span className="block text-[11.5px] font-normal text-muted">{opcion.detalle}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div>
              <label htmlFor={`${id}-codigo`} className={LABEL}>
                Código
              </label>
              <input
                id={`${id}-codigo`}
                value={producto.codigo}
                maxLength={60}
                onChange={(e) => onCambio({ codigo: e.target.value })}
                className={INPUT}
              />
            </div>
            <div>
              <label htmlFor={`${id}-nombre`} className={LABEL}>
                Nombre
              </label>
              <input
                id={`${id}-nombre`}
                value={producto.nombre}
                maxLength={120}
                onChange={(e) => onCambio({ nombre: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-categoria`} className={LABEL}>
                Categoría <span className="font-normal text-muted">(opcional)</span>
              </label>
              <input
                id={`${id}-categoria`}
                value={producto.categoria}
                maxLength={60}
                onChange={(e) => onCambio({ categoria: e.target.value })}
                className={INPUT}
              />
            </div>
            {producto.tipo === "a_medida" ? (
              <div>
                <span className={LABEL}>Moneda</span>
                <p className="py-2 text-[13px] text-ink-secondary">En pesos: los productos a medida se cotizan en pesos.</p>
              </div>
            ) : (
              <div role="radiogroup" aria-label={`Moneda de ${producto.nombre || "este producto"}`}>
                <span className={LABEL} aria-hidden="true">
                  Moneda
                </span>
                <div className="flex gap-1 rounded-md border border-line bg-sunken p-1">
                  {MONEDAS.map((opcion) => (
                    <label
                      key={opcion}
                      className={cn(SEGMENTO, producto.moneda === opcion ? "bg-card text-ink shadow-sm" : "text-ink-secondary")}
                    >
                      <input
                        type="radio"
                        name={`${id}-moneda`}
                        value={opcion}
                        checked={producto.moneda === opcion}
                        onChange={() => onCambio({ moneda: opcion })}
                        className="sr-only"
                      />
                      {NOMBRE_MONEDA[opcion]}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-descripcion`} className={LABEL}>
              Descripción <span className="font-normal text-muted">(la usa el asistente para recomendar)</span>
            </label>
            <textarea
              id={`${id}-descripcion`}
              value={producto.descripcion}
              maxLength={500}
              rows={3}
              onChange={(e) => onCambio({ descripcion: e.target.value })}
              className={INPUT}
            />
          </div>

          {producto.tipo === "a_medida" && (
            <fieldset className="flex flex-col gap-3">
              <legend className={LABEL}>Producto a medida</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-desde`} className={LABEL}>
                    Precio &ldquo;desde&rdquo; <span className="font-normal text-muted">(opcional)</span>
                  </label>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] text-muted">$</span>
                    <input
                      id={`${id}-desde`}
                      inputMode="decimal"
                      value={producto.precioDesde}
                      placeholder="Ej.: 450.000"
                      onChange={(e) => onCambio({ precioDesde: e.target.value })}
                      className={INPUT}
                    />
                  </span>
                </div>
                <div>
                  <label htmlFor={`${id}-materiales`} className={LABEL}>
                    Materiales <span className="font-normal text-muted">(opcional, separados por coma)</span>
                  </label>
                  <input
                    id={`${id}-materiales`}
                    value={producto.materiales}
                    placeholder="Ej.: pana, chenille, antidesgarro"
                    onChange={(e) => onCambio({ materiales: e.target.value })}
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className={LABEL}>
                  Versiones con precio fijo <span className="font-normal text-muted">(opcional, por ejemplo &ldquo;Tres cuerpos&rdquo;)</span>
                </span>
                {producto.versiones.map((version) => (
                  <div key={version.clave} className="grid grid-cols-[1fr_140px_auto] gap-2 rounded-md bg-sunken p-2.5">
                    <input
                      value={version.nombre}
                      maxLength={60}
                      placeholder="Nombre"
                      aria-label="Nombre de la versión"
                      onChange={(e) => cambiarVersion(version.clave, { nombre: e.target.value })}
                      className={INPUT}
                    />
                    <label className="flex items-center gap-1.5">
                      <span className="text-[13px] text-muted">$</span>
                      <input
                        inputMode="decimal"
                        value={version.precio}
                        placeholder="Precio"
                        aria-label={`Precio${version.nombre ? ` de ${version.nombre}` : " de la versión"}`}
                        onChange={(e) => cambiarVersion(version.clave, { precio: e.target.value })}
                        className={cn(INPUT, !version.precio.trim() && "border-warning")}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCambio({ versiones: producto.versiones.filter((v) => v.clave !== version.clave) })}
                    >
                      Quitar
                    </Button>
                  </div>
                ))}
                {producto.versiones.length < MAX_VERSIONES && (
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        onCambio({ versiones: [...producto.versiones, { clave: `n${Date.now()}`, nombre: "", precio: "" }] })
                      }
                    >
                      Agregar versión
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-[12px] text-muted">
                Las preguntas que tu asistente le hace al cliente y cómo se cotiza las configurás después, desde el editor
                del producto.
              </p>
            </fieldset>
          )}

          {producto.tipo === "stock" && (
            <fieldset className="flex flex-col gap-2">
              <legend className={LABEL}>{producto.variantes.length > 1 ? "Variantes" : "Precio y stock"}</legend>
              {producto.variantes.map((variante) => (
                <div key={variante.clave} className="grid grid-cols-2 gap-2 rounded-md bg-sunken p-2.5 sm:grid-cols-[1fr_140px_140px_110px]">
                  {producto.variantes.length > 1 ? (
                    <input
                      value={variante.nombre}
                      maxLength={60}
                      aria-label="Nombre de la variante"
                      onChange={(e) => cambiarVariante(variante.clave, { nombre: e.target.value })}
                      className={cn(INPUT, "col-span-2 sm:col-span-1")}
                    />
                  ) : (
                    <span className="col-span-2 self-center text-[13px] text-muted sm:col-span-1">Única</span>
                  )}
                  <label className="flex items-center gap-1.5">
                    <span className="text-[13px] text-muted">{simbolo}</span>
                    <input
                      inputMode="decimal"
                      value={variante.precio}
                      placeholder="Precio"
                      aria-label={`Precio${variante.nombre ? ` de ${variante.nombre}` : ""}`}
                      onChange={(e) => cambiarVariante(variante.clave, { precio: e.target.value })}
                      className={cn(INPUT, !variante.precio.trim() && "border-warning")}
                    />
                  </label>
                  <input
                    value={variante.sku}
                    maxLength={60}
                    placeholder="SKU (opcional)"
                    aria-label={`SKU${variante.nombre ? ` de ${variante.nombre}` : ""}`}
                    onChange={(e) => cambiarVariante(variante.clave, { sku: e.target.value })}
                    className={INPUT}
                  />
                  <input
                    inputMode="numeric"
                    value={variante.stock}
                    placeholder="Stock"
                    aria-label={`Stock${variante.nombre ? ` de ${variante.nombre}` : ""}`}
                    onChange={(e) => cambiarVariante(variante.clave, { stock: e.target.value })}
                    className={INPUT}
                  />
                </div>
              ))}
              <p className="text-[12px] text-muted">El stock no se trae de la página: dejalo vacío si no lo controlás.</p>
            </fieldset>
          )}

          {borrador.imagenes.length > 0 && (
            <div role="radiogroup" aria-label="Foto del producto">
              <span className={LABEL} aria-hidden="true">
                Foto <span className="font-normal text-muted">(tu asistente la manda cuando se la piden)</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {borrador.imagenes.map((imagen, indice) => (
                  <label
                    key={imagen}
                    className={cn(
                      "relative size-20 cursor-pointer overflow-hidden rounded-md border-2 bg-sunken",
                      producto.imagen === indice ? "border-primary" : "border-transparent",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${id}-foto`}
                      checked={producto.imagen === indice}
                      onChange={() => onCambio({ imagen: indice })}
                      className="sr-only"
                      aria-label={`Foto ${indice + 1}`}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element -- es una foto de la página de origen, sólo para elegir */}
                    <img src={imagen} alt="" referrerPolicy="no-referrer" loading="lazy" className="size-full object-cover" />
                  </label>
                ))}
                <label
                  className={cn(
                    "grid size-20 cursor-pointer place-items-center rounded-md border-2 bg-sunken px-1 text-center text-[12px] text-ink-secondary",
                    producto.imagen === null ? "border-primary" : "border-transparent",
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-foto`}
                    checked={producto.imagen === null}
                    onChange={() => onCambio({ imagen: null })}
                    className="sr-only"
                  />
                  Sin foto
                </label>
              </div>
            </div>
          )}

          {problema && (
            <p role="status" className="text-[13px] font-semibold text-warning-text">
              {problema}
            </p>
          )}
        </>
      )}
    </li>
  );
}
