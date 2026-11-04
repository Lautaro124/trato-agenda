"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FotoProducto, guardarConFoto } from "@/components/productos/FotoProducto";
import { PantallaProducto } from "@/components/productos/PantallaProducto";
import { FilaInterruptor } from "@/components/ui/FilaInterruptor";
import { cn } from "@/lib/cn";
import {
  leerValorDescuento,
  montoDeDescuento,
  problemaDeDescuento,
  vistaPrevia,
  type DescuentoAGuardar,
  type TipoDescuento,
} from "@/lib/descuentos";
import { armarCuotas, cuotasDesdeProducto, SeccionCuotas, type CuotasEnEdicion } from "@/components/productos/SeccionCuotas";
import {
  centavosParaInput,
  ErrorDeApi,
  leerCentavos,
  MONEDAS,
  NOMBRE_MONEDA,
  type Moneda,
  type Producto,
  type ProductoAGuardar,
} from "@/lib/productos";

export const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
export const LABEL = "mb-1.5 block text-[12.5px] font-semibold text-ink-secondary";

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
function armarDescuento(descuento: DescuentoEnEdicion, precioCentavos: number): DescuentoAGuardar | null | string {
  if (!descuento.tiene) return null;
  const valor = leerValorDescuento(descuento.tipo, descuento.valor);
  const problema = problemaDeDescuento({ tipo: descuento.tipo, valor, desde: descuento.desde, hasta: descuento.hasta });
  if (problema || valor === null) return problema ?? "Revisá el descuento.";
  if (descuento.tipo === "monto" && valor >= precioCentavos) {
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

/**
 * Alta o edición completa de un producto, en su propia pantalla
 * (/productos/nuevo o /productos/[id]): precio, stock y descuento.
 */
export function EditorProducto({
  producto: productoInicial,
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
  const idCampos = useId();
  const primerCampo = useRef<HTMLInputElement>(null);
  // Si se guardó pero la foto elegida antes no subió, la pantalla sigue abierta sobre el producto ya creado.
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const producto = guardado ?? productoInicial;
  const [fotoPendiente, setFotoPendiente] = useState<File | null>(null);
  const [codigo, setCodigo] = useState(productoInicial?.codigo ?? "");
  const [nombre, setNombre] = useState(productoInicial?.nombre ?? "");
  const [categoria, setCategoria] = useState(productoInicial?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(productoInicial?.descripcion ?? "");
  const [moneda, setMoneda] = useState<Moneda>(productoInicial?.moneda ?? "ARS");
  const [cuotas, setCuotas] = useState<CuotasEnEdicion>(() => cuotasDesdeProducto(productoInicial?.cuotas));
  const [precio, setPrecio] = useState(productoInicial ? centavosParaInput(productoInicial.precioCentavos) : "");
  const [stock, setStock] = useState(productoInicial?.stock == null ? "" : String(productoInicial.stock));
  const [stockMinimo, setStockMinimo] = useState(
    productoInicial?.stockMinimo == null ? "" : String(productoInicial.stockMinimo),
  );
  const [disponible, setDisponible] = useState(productoInicial?.disponible ?? true);
  const [descuento, setDescuento] = useState<DescuentoEnEdicion>(() => descuentoDesdeProducto(productoInicial));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Foto del formulario al abrirlo, para saber si hay algo sin guardar.
  const firmar = (foto: File | null) =>
    JSON.stringify([
      codigo,
      nombre,
      categoria,
      descripcion,
      moneda,
      cuotas,
      precio,
      stock,
      stockMinimo,
      disponible,
      descuento,
      foto?.name ?? null,
    ]);
  const formulario = firmar(fotoPendiente);
  const [formularioInicial, setFormularioInicial] = useState(formulario);
  const hayCambios = formulario !== formularioInicial;

  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  /** Valida en el navegador lo mismo que la API, para no gastar un viaje en un error obvio. */
  const armar = (): ProductoAGuardar | string => {
    if (!codigo.trim()) return "Poné un código para el producto.";
    if (nombre.trim().length < 2) return "Poné el nombre del producto.";
    const precioCentavos = leerCentavos(precio);
    if (precioCentavos === null) return "Revisá el precio.";
    const unidades = entero(stock);
    const minimo = entero(stockMinimo);
    if (unidades === "invalido" || minimo === "invalido") return "El stock tiene que ser un número entero.";
    const descuentoArmado = armarDescuento(descuento, precioCentavos);
    if (typeof descuentoArmado === "string") return descuentoArmado;
    const cuotasArmadas = armarCuotas(cuotas, precioCentavos, moneda);
    if (typeof cuotasArmadas === "string") return cuotasArmadas;
    return {
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      categoria: categoria.trim() || null,
      descripcion: descripcion.trim(),
      moneda,
      cuotas: cuotasArmadas,
      precioCentavos,
      stock: unidades,
      // Sin cantidad cargada no hay mínimo que vigilar.
      stockMinimo: unidades === null ? null : minimo,
      disponible,
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
    guardarConFoto(datos, producto?.id, producto ? null : fotoPendiente)
      .then(({ producto: nuevo, errorFoto }) => {
        if (!errorFoto) return onGuardado(nuevo);
        // Quedó guardado sin la foto: la pantalla sigue abierta sobre el producto creado para reintentarla.
        setGuardado(nuevo);
        setFotoPendiente(null);
        setFormularioInicial(firmar(null));
        setError(errorFoto);
        onFotoCambiada?.();
      })
      .catch((err: unknown) =>
        setError(err instanceof ErrorDeApi ? err.message : "No pudimos guardar el producto. Probá de nuevo."),
      )
      .finally(() => setGuardando(false));
  };

  // El precio que ve el cliente, con el descuento propio si está activo: la base de las cuotas.
  const precioLista = leerCentavos(precio);
  const valorDescuento = descuento.tiene && descuento.activo ? leerValorDescuento(descuento.tipo, descuento.valor) : null;
  const precioConDescuento =
    precioLista === null
      ? null
      : precioLista - (valorDescuento === null ? 0 : montoDeDescuento({ tipo: descuento.tipo, valor: valorDescuento }, precioLista));

  return (
    <PantallaProducto
      titulo={producto ? "Editar producto" : "Nuevo producto"}
      migas={
        producto
          ? [{ label: "Productos", href: "/productos" }, { label: producto.nombre }]
          : [{ label: "Productos", href: "/productos" }, { label: "Nuevo" }]
      }
      hayCambios={hayCambios}
      guardando={guardando}
      error={error}
      onCerrar={onCerrar}
      onGuardar={guardar}
    >
      {/* En pantallas grandes, dos columnas: datos y descuento a la izquierda, precio y stock a la derecha. */}
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
            pendiente={fotoPendiente}
            onPendiente={setFotoPendiente}
          />

          <SeccionDescuento
            descuento={descuento}
            moneda={moneda}
            precioCentavos={leerCentavos(precio)}
            onCambio={(cambios) => setDescuento((actual) => ({ ...actual, ...cambios }))}
          />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className={LABEL}>Precio y stock</legend>
          <div role="radiogroup" aria-label="Moneda del precio">
            <span className={LABEL} aria-hidden="true">
              Moneda
            </span>
            <div className="flex gap-1 rounded-md border border-line bg-sunken p-1">
              {MONEDAS.map((opcion) => (
                <label
                  key={opcion}
                  className={cn(SEGMENTO, moneda === opcion ? "bg-card text-ink shadow-sm" : "text-ink-secondary")}
                >
                  <input
                    type="radio"
                    name="moneda-producto"
                    value={opcion}
                    checked={moneda === opcion}
                    onChange={() => setMoneda(opcion)}
                    className="sr-only"
                  />
                  {NOMBRE_MONEDA[opcion]}
                </label>
              ))}
            </div>
            {moneda === "USD" && (
              <p className="mt-1.5 text-[12.5px] text-muted">
                El asistente lo ofrece en dólares y esos pedidos se cobran a mano: Mercado Pago cobra en pesos, por eso no hay cuotas.
              </p>
            )}
          </div>
          <div className="grid gap-3 rounded-md bg-sunken p-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${idCampos}-precio`} className={LABEL}>
                Precio
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-muted">{moneda === "USD" ? "US$" : "$"}</span>
                <input
                  id={`${idCampos}-precio`}
                  inputMode="decimal"
                  value={precio}
                  placeholder="0"
                  onChange={(e) => setPrecio(e.target.value)}
                  className={INPUT}
                />
              </div>
            </div>
            <div>
              <label htmlFor={`${idCampos}-stock`} className={LABEL}>
                Stock (unidades)
              </label>
              <input
                id={`${idCampos}-stock`}
                inputMode="numeric"
                value={stock}
                placeholder="Vacío = sin control de stock"
                onChange={(e) => setStock(e.target.value)}
                className={INPUT}
              />
            </div>
            {stock.trim() === "" ? (
              // Sin cantidad cargada, la disponibilidad se marca a mano.
              <div className="flex flex-col justify-end sm:col-span-2">
                <span className={LABEL}>¿Está disponible?</span>
                <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
                  <input type="checkbox" checked={disponible} onChange={(e) => setDisponible(e.target.checked)} />
                  Hay stock
                </label>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <label htmlFor={`${idCampos}-minimo`} className={LABEL}>
                  Avisarme cuando queden menos de <span className="font-normal text-muted">(unidades)</span>
                </label>
                <input
                  id={`${idCampos}-minimo`}
                  inputMode="numeric"
                  value={stockMinimo}
                  placeholder="Opcional"
                  onChange={(e) => setStockMinimo(e.target.value)}
                  className={INPUT}
                />
              </div>
            )}
          </div>
        </fieldset>
      </div>

      {moneda === "ARS" && (
        <SeccionCuotas
          cuotas={cuotas}
          baseCentavos={precioConDescuento}
          onCambio={(cambios) => setCuotas((actual) => ({ ...actual, ...cambios }))}
        />
      )}
    </PantallaProducto>
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
  moneda,
  precioCentavos,
  onCambio,
}: Readonly<{
  descuento: DescuentoEnEdicion;
  moneda: Moneda;
  precioCentavos: number | null;
  onCambio: (cambios: Partial<DescuentoEnEdicion>) => void;
}>) {
  const valor = leerValorDescuento(descuento.tipo, descuento.valor);
  const previa =
    valor === null || precioCentavos === null ? null : vistaPrevia({ tipo: descuento.tipo, valor }, precioCentavos, moneda);

  return (
    <fieldset
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        descuento.tiene ? "border-[var(--color-primitive-coral-200)] bg-primary-subtle" : "border-line",
      )}
    >
      <legend className="px-1 text-[13.5px] font-bold text-ink">Descuento</legend>
      <FilaInterruptor
        titulo="Este producto tiene descuento"
        ayuda={descuento.tiene ? "Elegí cuánto se descuenta y, si querés, durante qué fechas." : "Apagado: se cobra el precio completo."}
        checked={descuento.tiene}
        onChange={(tiene) => onCambio({ tiene })}
      />

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
                {descuento.tipo === "monto" && <span className="text-[13px] text-muted">{moneda === "USD" ? "US$" : "$"}</span>}
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

          <FilaInterruptor
            titulo="Descuento activo"
            ayuda={descuento.activo ? "Se cobra con el descuento." : "Pausado: se cobra el precio completo, sin perder lo configurado."}
            checked={descuento.activo}
            onChange={(activo) => onCambio({ activo })}
          />

          {previa && (
            <div className="rounded-md bg-card px-3 py-2.5">
              <p className="text-[11.5px] font-bold tracking-[0.04em] text-muted uppercase">Así lo va a cobrar el asistente</p>
              <p className="mt-1 text-[14px] text-ink">
                <span className="text-muted line-through">{previa.lista}</span> →{" "}
                <strong className="text-[var(--color-primitive-coral-700)]">{previa.final}</strong>
                <span className="text-ink-secondary"> · ahorra {previa.ahorro}</span>
              </p>
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
