"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FotosPendientes, FotosProducto, guardarConFotos } from "@/components/productos/FotosProducto";
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
import { armarPreguntas, preguntasDesdeProducto, SeccionPreguntas, type PreguntaEnEdicion } from "@/components/productos/SeccionPreguntas";
import {
  centavosParaInput,
  ErrorDeApi,
  leerCentavos,
  MONEDAS,
  NOMBRE_MONEDA,
  type Moneda,
  PLAZO_ENTREGA_MAX_DIAS,
  type Producto,
  type ProductoAGuardar,
} from "@/lib/productos";
import { CampoNumero } from "@/components/ui/CampoNumero";
import { leerEntero } from "@/lib/numeros";

/** Con stock se cuentan unidades; a demanda se prepara al pedirlo y se informa el plazo de entrega. */
type ModoStock = "stock" | "demanda";

const MODOS_STOCK: Array<{ modo: ModoStock; etiqueta: string }> = [
  { modo: "stock", etiqueta: "Con stock" },
  { modo: "demanda", etiqueta: "A demanda" },
];

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

/** Un número guardado → el texto del input (vacío si no hay). */
function textoDeNumero(valor: number | null | undefined): string {
  return valor == null ? "" : String(valor);
}


/**
 * Con stock: unidades obligatorias y mínimo opcional. A demanda: sólo el plazo
 * de entrega (sin unidades ni mínimo que vigilar).
 */
function armarDisponibilidad(
  modo: ModoStock,
  stock: string,
  stockMinimo: string,
  plazoEntrega: string,
): Pick<ProductoAGuardar, "stock" | "stockMinimo" | "plazoEntregaDias"> | string {
  if (modo === "demanda") {
    const plazo = leerEntero(plazoEntrega);
    if (typeof plazo !== "number" || plazo < 1 || plazo > PLAZO_ENTREGA_MAX_DIAS) {
      return `Poné en cuántos días lo entregás (de 1 a ${PLAZO_ENTREGA_MAX_DIAS}).`;
    }
    return { stock: null, stockMinimo: null, plazoEntregaDias: plazo };
  }
  const unidades = leerEntero(stock);
  const minimo = leerEntero(stockMinimo);
  if (unidades === "invalido" || minimo === "invalido") return "El stock tiene que ser un número entero.";
  if (unidades === null) return "Poné cuántas unidades tenés en stock.";
  return { stock: unidades, stockMinimo: minimo, plazoEntregaDias: null };
}

/**
 * Alta o edición completa de un producto, en su propia pantalla
 * (/productos/nuevo o /productos/[id]): datos, fotos, precio, stock y descuento.
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
  /** Las fotos se guardan solas (no esperan al "Guardar"): avisa para refrescar el listado. */
  onFotoCambiada?: () => void;
}) {
  const idCampos = useId();
  const primerCampo = useRef<HTMLInputElement>(null);
  // Si se guardó pero alguna foto elegida antes no subió, la pantalla sigue abierta sobre el producto ya creado.
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const producto = guardado ?? productoInicial;
  const [fotosPendientes, setFotosPendientes] = useState<File[]>([]);
  const [codigo, setCodigo] = useState(productoInicial?.codigo ?? "");
  const [nombre, setNombre] = useState(productoInicial?.nombre ?? "");
  const [categoria, setCategoria] = useState(productoInicial?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(productoInicial?.descripcion ?? "");
  const [moneda, setMoneda] = useState<Moneda>(productoInicial?.moneda ?? "ARS");
  const [cuotas, setCuotas] = useState<CuotasEnEdicion>(() => cuotasDesdeProducto(productoInicial?.cuotas));
  const [preguntas, setPreguntas] = useState<PreguntaEnEdicion[]>(() => preguntasDesdeProducto(productoInicial?.preguntas));
  const [precio, setPrecio] = useState(productoInicial ? centavosParaInput(productoInicial.precioCentavos) : "");
  // Un producto existente sin cantidad es a demanda; uno nuevo arranca con stock.
  const [modoStock, setModoStock] = useState<ModoStock>(
    productoInicial?.stock === null ? "demanda" : "stock",
  );
  const [stock, setStock] = useState(textoDeNumero(productoInicial?.stock));
  const [plazoEntrega, setPlazoEntrega] = useState(
    textoDeNumero(productoInicial?.plazoEntregaDias),
  );
  const [stockMinimo, setStockMinimo] = useState(
    textoDeNumero(productoInicial?.stockMinimo),
  );
  // No se edita acá (se pausa desde el listado): se reenvía para no pisarlo.
  const disponible = productoInicial?.disponible ?? true;
  const [descuento, setDescuento] = useState<DescuentoEnEdicion>(() => descuentoDesdeProducto(productoInicial));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Foto del formulario al abrirlo, para saber si hay algo sin guardar.
  const firmar = (fotos: File[]) =>
    JSON.stringify([
      codigo,
      nombre,
      categoria,
      descripcion,
      moneda,
      cuotas,
      preguntas,
      precio,
      modoStock,
      stock,
      stockMinimo,
      plazoEntrega,
      descuento,
      fotos.map((foto) => foto.name),
    ]);
  const formulario = firmar(fotosPendientes);
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
    const disponibilidad = armarDisponibilidad(modoStock, stock, stockMinimo, plazoEntrega);
    if (typeof disponibilidad === "string") return disponibilidad;
    const descuentoArmado = armarDescuento(descuento, precioCentavos);
    if (typeof descuentoArmado === "string") return descuentoArmado;
    const cuotasArmadas = armarCuotas(cuotas, precioCentavos, moneda);
    if (typeof cuotasArmadas === "string") return cuotasArmadas;
    const preguntasArmadas = armarPreguntas(preguntas);
    if (typeof preguntasArmadas === "string") return preguntasArmadas;
    return {
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      categoria: categoria.trim() || null,
      descripcion: descripcion.trim(),
      moneda,
      cuotas: cuotasArmadas,
      preguntas: preguntasArmadas,
      precioCentavos,
      ...disponibilidad,
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
    guardarConFotos(datos, producto?.id, producto ? [] : fotosPendientes)
      .then(({ producto: nuevo, errorFoto }) => {
        if (!errorFoto) return onGuardado(nuevo);
        // Quedó guardado sin alguna foto: la pantalla sigue abierta sobre el producto creado para reintentarla.
        setGuardado(nuevo);
        setFotosPendientes([]);
        setFormularioInicial(firmar([]));
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
      {/* En pantallas grandes, dos columnas: datos y fotos a la izquierda; precio, stock y descuento a la derecha. */}
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

          {producto ? (
            <FotosProducto
              key={producto.id}
              productoId={producto.id}
              fotosIniciales={producto.imagenes}
              onCambio={() => onFotoCambiada?.()}
            />
          ) : (
            <FotosPendientes archivos={fotosPendientes} onCambio={setFotosPendientes} />
          )}
        </div>

        <div className="flex flex-col gap-4">
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
              <div role="radiogroup" aria-label="Disponibilidad" className="sm:col-span-2">
                <span className={LABEL} aria-hidden="true">
                  Disponibilidad
                </span>
                <div className="flex gap-1 rounded-md border border-line bg-card p-1">
                  {MODOS_STOCK.map(({ modo, etiqueta }) => (
                    <label
                      key={modo}
                      className={cn(SEGMENTO, "relative", modoStock === modo ? "bg-sunken text-ink shadow-sm" : "text-ink-secondary")}
                    >
                      <input
                        type="radio"
                        name="modo-stock-producto"
                        value={modo}
                        checked={modoStock === modo}
                        onChange={() => setModoStock(modo)}
                        className="absolute inset-0 m-0 cursor-pointer opacity-0"
                      />
                      {etiqueta}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor={`${idCampos}-precio`} className={LABEL}>
                  Precio
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-muted">{moneda === "USD" ? "US$" : "$"}</span>
                  <CampoNumero
                    id={`${idCampos}-precio`}
                    decimales
                    value={precio}
                    placeholder="0"
                    onValueChange={setPrecio}
                    className={INPUT}
                  />
                </div>
              </div>
              {modoStock === "demanda" ? (
                <div>
                  <label htmlFor={`${idCampos}-plazo`} className={LABEL}>
                    Tiempo de entrega <span className="font-normal text-muted">(días)</span>
                  </label>
                  <input
                    id={`${idCampos}-plazo`}
                    inputMode="numeric"
                    value={plazoEntrega}
                    placeholder="Ej. 7"
                    aria-describedby={`${idCampos}-plazo-ayuda`}
                    onChange={(e) => setPlazoEntrega(e.target.value)}
                    className={INPUT}
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor={`${idCampos}-stock`} className={LABEL}>
                    Stock (unidades)
                  </label>
                  <CampoNumero
                    id={`${idCampos}-stock`}
                    value={stock}
                    placeholder="0"
                    onValueChange={setStock}
                    className={INPUT}
                  />
                </div>
              )}
              {modoStock === "demanda" ? (
                <p id={`${idCampos}-plazo-ayuda`} className="text-[12.5px] text-muted sm:col-span-2">
                  Lo preparás cuando te lo piden: el asistente le avisa al cliente en cuántos días se entrega.
                </p>
              ) : (
                <div className="sm:col-span-2">
                  <label htmlFor={`${idCampos}-minimo`} className={LABEL}>
                    Avisarme cuando queden menos de <span className="font-normal text-muted">(unidades)</span>
                  </label>
                  <CampoNumero
                    id={`${idCampos}-minimo`}
                    value={stockMinimo}
                    placeholder="Opcional"
                    onValueChange={setStockMinimo}
                    className={INPUT}
                  />
                </div>
              )}
            </div>
          </fieldset>

          <SeccionDescuento
            descuento={descuento}
            moneda={moneda}
            precioCentavos={leerCentavos(precio)}
            onCambio={(cambios) => setDescuento((actual) => ({ ...actual, ...cambios }))}
          />
        </div>
      </div>

      {moneda === "ARS" && (
        <SeccionCuotas
          cuotas={cuotas}
          baseCentavos={precioConDescuento}
          onCambio={(cambios) => setCuotas((actual) => ({ ...actual, ...cambios }))}
        />
      )}

      <SeccionPreguntas preguntas={preguntas} onCambio={setPreguntas} />
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
                <CampoNumero
                  id="descuento-valor"
                  decimales={descuento.tipo === "monto"}
                  value={descuento.valor}
                  placeholder={descuento.tipo === "porcentaje" ? "20" : "500"}
                  onValueChange={(valor) => onCambio({ valor })}
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
