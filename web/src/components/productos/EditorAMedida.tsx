"use client";

import { useEffect, useRef, useState } from "react";
import { DialogoProducto } from "@/components/productos/DialogoProducto";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { FotoProducto, guardarConFoto } from "@/components/productos/FotoProducto";
import { SeccionCotizacion, useRecetaEnEdicion } from "@/components/productos/SeccionCotizacion";
import { SeccionMateriales } from "@/components/productos/SeccionMateriales";
import { SeccionVariantesFijas, useVersionesFijas } from "@/components/productos/SeccionVariantesFijas";
import {
  EncabezadoDeSeccion,
  opcionesDe,
  SeccionSolicitud,
  useSolicitudEnEdicion,
} from "@/components/productos/SeccionSolicitud";
import { VistaPreviaAMedida } from "@/components/productos/VistaPreviaAMedida";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { obtenerCostos, type Insumo } from "@/lib/costos";
import {
  centavosParaInput,
  ErrorDeApi,
  formatearCentavos,
  leerCentavos,
  type Producto,
  type ProductoAMedidaAGuardar,
} from "@/lib/productos";
import { codigoDesdeNombre, enUnaLinea, limpiarMateriales, MAX_MATERIALES } from "@/lib/solicitud";

/** Cuántas veces se prueba otro código automático si el elegido ya lo tiene otro producto. */
const REINTENTOS_DE_CODIGO = 3;

const OPCION_PRECIO =
  "flex flex-1 cursor-pointer items-center justify-center rounded-sm px-3 py-2 text-center text-[13.5px] font-semibold";

/**
 * Alta o edición de un producto a medida (cuenta a pedido), por pasos: qué
 * es, en qué materiales se hace, sus versiones con precio fijo (opcionales),
 * si tiene un precio "desde", qué le pregunta el asistente al cliente para
 * cotizarlo y cómo se cotiza. Al costado, cómo va a preguntar el asistente
 * con lo que se va cargando. El código se arma solo con el nombre (se puede
 * cambiar) y las fotos se pueden elegir antes de guardar.
 */
export function EditorAMedida({
  producto: productoInicial,
  codigosUsados,
  onCerrar,
  onGuardado,
  onFotoCambiada,
}: Readonly<{
  producto: Producto | null;
  /** Los códigos que ya usa la cuenta, para que el automático no choque. */
  codigosUsados: ReadonlySet<string>;
  onCerrar: () => void;
  onGuardado: (producto: Producto) => void;
  /** La foto de un producto existente se guarda sola: avisa para refrescar el listado. */
  onFotoCambiada?: () => void;
}>) {
  const primerCampo = useRef<HTMLInputElement>(null);
  // Si se guardó pero la foto elegida antes no subió, el diálogo sigue abierto sobre el producto ya creado.
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const producto = guardado ?? productoInicial;
  const [fotoPendiente, setFotoPendiente] = useState<File | null>(null);

  const [nombre, setNombre] = useState(productoInicial?.nombre ?? "");
  const [categoria, setCategoria] = useState(productoInicial?.categoria ?? "");
  const [descripcion, setDescripcion] = useState(productoInicial?.descripcion ?? "");
  // Uno existente ya tiene su código; uno nuevo lo arma con el nombre hasta que el dueño lo cambie.
  const [codigoPropio, setCodigoPropio] = useState<string | null>(productoInicial?.codigo ?? null);
  const [editandoCodigo, setEditandoCodigo] = useState(false);
  const codigo = codigoPropio ?? codigoDesdeNombre(nombre, codigosUsados);

  const [materiales, setMateriales] = useState<string[]>(productoInicial?.materiales ?? []);
  const [nuevoMaterial, setNuevoMaterial] = useState("");
  const [conDesde, setConDesde] = useState(Boolean(productoInicial?.precioReferenciaCentavos));
  const [desde, setDesde] = useState(
    productoInicial?.precioReferenciaCentavos ? centavosParaInput(productoInicial.precioReferenciaCentavos) : "",
  );
  const versiones = useVersionesFijas(productoInicial);
  const solicitud = useSolicitudEnEdicion(productoInicial?.solicitud ?? null);
  const receta = useRecetaEnEdicion(productoInicial?.receta ?? null, productoInicial?.politicaCotizacion ?? "manual");
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialesArmados = limpiarMateriales([...materiales, nuevoMaterial]);
  const desdeCentavos = conDesde ? leerCentavos(desde) : null;

  // Foto del formulario al abrirlo, para saber si hay algo sin guardar.
  const firmar = (codigoFirmado: string | null, foto: File | null) =>
    JSON.stringify([
      codigoFirmado,
      nombre,
      categoria,
      descripcion,
      materialesArmados,
      conDesde ? desde : null,
      versiones.firma,
      solicitud.firma,
      receta.firma,
      foto?.name ?? null,
    ]);
  const formulario = firmar(codigoPropio, fotoPendiente);
  const [formularioInicial, setFormularioInicial] = useState(formulario);
  const hayCambios = formulario !== formularioInicial;

  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  // Los materiales y costos del comercio, para elegirlos en la receta.
  useEffect(() => {
    const ctrl = { cancelado: false };
    obtenerCostos()
      .then(({ insumos: cargados }) => !ctrl.cancelado && setInsumos(cargados))
      .catch(() => !ctrl.cancelado && setInsumos([]));
    return () => {
      ctrl.cancelado = true;
    };
  }, []);

  // Lo que falta, dicho en el pie mientras se completa: no hace falta tocar "Guardar" para enterarse.
  const faltan = [
    ...(nombre.trim().length < 2 ? ["el nombre"] : []),
    ...(codigoPropio !== null && !codigoPropio.trim() ? ["el código"] : []),
    ...versiones.faltan,
    ...(conDesde && desdeCentavos === null ? ["el precio desde"] : []),
    ...(solicitud.sinEscribir > 0
      ? [solicitud.sinEscribir === 1 ? "escribir 1 pregunta" : `escribir ${solicitud.sinEscribir} preguntas`]
      : []),
    ...(receta.problema() ? ["completar la receta"] : []),
  ];

  /** Valida en el navegador lo mismo que la API, para no gastar un viaje en un error obvio. */
  const armar = (): ProductoAMedidaAGuardar | string => {
    if (nombre.trim().length < 2) return "Poné el nombre del producto.";
    if (!codigo.trim()) return "Poné un código para el producto.";
    if (conDesde && desdeCentavos === null) return "Revisá el precio desde, o elegí “No, siempre lo cotizo”.";
    if (materialesArmados.length > MAX_MATERIALES) return `Un producto puede tener hasta ${MAX_MATERIALES} materiales.`;
    const variantes = versiones.armar();
    if (typeof variantes === "string") return variantes;
    const solicitudArmada = solicitud.armar();
    if (typeof solicitudArmada === "string") return solicitudArmada;
    const problemaReceta = receta.problema();
    if (problemaReceta) return problemaReceta;
    return {
      codigo: codigo.trim(),
      nombre: nombre.trim(),
      categoria: categoria.trim() || null,
      descripcion: descripcion.trim(),
      materiales: materialesArmados,
      variantes,
      precioReferenciaCentavos: desdeCentavos,
      solicitud: solicitudArmada,
      receta: receta.receta(),
      politicaCotizacion: receta.politica,
    };
  };

  /**
   * Guarda; si el código automático ya lo usa otro producto (uno que no está
   * en la página cargada), prueba con el siguiente libre.
   */
  const guardarConCodigoLibre = async (datos: ProductoAMedidaAGuardar) => {
    const usados = new Set(codigosUsados);
    let intento = { ...datos };
    for (let vuelta = 0; ; vuelta += 1) {
      try {
        return await guardarConFoto(intento, producto?.id, producto ? null : fotoPendiente);
      } catch (err) {
        const choca = err instanceof ErrorDeApi && err.message.startsWith("Ya hay un producto con el código");
        if (!choca || codigoPropio !== null || vuelta >= REINTENTOS_DE_CODIGO) throw err;
        usados.add(intento.codigo.toUpperCase());
        intento = { ...intento, codigo: codigoDesdeNombre(nombre, usados) };
      }
    }
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
    guardarConCodigoLibre(datos)
      .then(async ({ producto: nuevo, errorFoto }) => {
        // Las fotos de las versiones van con el id de cada una, que recién existe ahora.
        const errorVersiones = await versiones.guardarFotos(nuevo);
        if (!errorFoto && !errorVersiones) return onGuardado(nuevo);
        // Quedó guardado sin alguna foto: el diálogo sigue abierto sobre el producto creado para reintentarla.
        setGuardado(nuevo);
        setCodigoPropio(nuevo.codigo);
        setFotoPendiente(null);
        versiones.reiniciar(nuevo);
        setFormularioInicial(firmar(nuevo.codigo, null));
        setError([errorFoto, errorVersiones].filter(Boolean).join(" "));
        onFotoCambiada?.();
      })
      .catch((err: unknown) =>
        setError(err instanceof ErrorDeApi ? err.message : "No pudimos guardar el producto. Probá de nuevo."),
      )
      .finally(() => setGuardando(false));
  };

  const vistaPrevia = (
    <VistaPreviaAMedida
      nombre={nombre}
      materiales={materialesArmados}
      desde={desdeCentavos === null ? null : formatearCentavos(desdeCentavos)}
      versiones={versiones.versiones.flatMap((v) => {
        const precio = leerCentavos(v.precio);
        return enUnaLinea(v.nombre) && precio !== null ? [{ nombre: enUnaLinea(v.nombre), precio: formatearCentavos(precio) }] : [];
      })}
      preguntas={solicitud.preguntas.map((p) => ({ texto: enUnaLinea(p.texto), opciones: opcionesDe(p) }))}
    />
  );

  return (
    <DialogoProducto
      titulo={producto ? "Editar producto a medida" : "Nuevo producto a medida"}
      junto={<Badge tone="info">Se cotiza</Badge>}
      ancho
      hayCambios={hayCambios}
      guardando={guardando}
      error={error}
      aviso={
        faltan.length > 0 ? (
          <p className="mr-auto basis-full text-[13px] text-ink-secondary sm:basis-auto">
            <span className="font-semibold text-[var(--color-primitive-coral-700)]">Falta:</span> {faltan.join(", ")}
          </p>
        ) : hayCambios ? (
          <p className="mr-auto basis-full text-[13px] font-semibold text-success-text sm:basis-auto">Listo para guardar</p>
        ) : null
      }
      onCerrar={onCerrar}
      onGuardar={guardar}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-7">
          <section aria-label="Qué hacés a medida" className="flex flex-col gap-3">
            <EncabezadoDeSeccion numero={1} titulo="¿Qué hacés a medida?" />
            <div className="flex flex-col gap-3 sm:pl-10">
              <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <div>
                  <label htmlFor="producto-nombre" className={LABEL}>
                    Nombre
                  </label>
                  <input
                    id="producto-nombre"
                    ref={primerCampo}
                    value={nombre}
                    maxLength={120}
                    placeholder="Ej.: Placard a medida"
                    onChange={(e) => setNombre(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label htmlFor="producto-categoria" className={LABEL}>
                    Categoría <span className="font-normal text-muted">(opcional)</span>
                  </label>
                  <input
                    id="producto-categoria"
                    value={categoria}
                    maxLength={60}
                    placeholder="Ej.: Muebles"
                    onChange={(e) => setCategoria(e.target.value)}
                    className={INPUT}
                  />
                </div>
              </div>

              {editandoCodigo ? (
                <div className="sm:max-w-[260px]">
                  <label htmlFor="producto-codigo" className={LABEL}>
                    Código <span className="font-normal text-muted">(para encontrarlo vos)</span>
                  </label>
                  <input
                    id="producto-codigo"
                    value={codigo}
                    maxLength={60}
                    onChange={(e) => setCodigoPropio(e.target.value)}
                    className={INPUT}
                  />
                </div>
              ) : (
                <p className="text-[12.5px] text-muted">
                  Código: <span className="font-mono text-ink-secondary">{codigo}</span> ·{" "}
                  <button
                    type="button"
                    aria-label="Cambiar código"
                    onClick={() => {
                      setCodigoPropio(codigo);
                      setEditandoCodigo(true);
                    }}
                    className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Cambiar
                  </button>
                </p>
              )}

              <div>
                <label htmlFor="producto-descripcion" className={LABEL}>
                  Contale a tu asistente qué incluye <span className="font-normal text-muted">(opcional)</span>
                </label>
                <textarea
                  id="producto-descripcion"
                  value={descripcion}
                  maxLength={500}
                  rows={3}
                  placeholder="Ej.: Placards con puertas, cajones y estantes, con instalación incluida."
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
                ayuda="tu asistente la manda cuando le muestra el producto al cliente"
              />
            </div>
          </section>

          <SeccionMateriales
            numero={2}
            materiales={materiales}
            nuevo={nuevoMaterial}
            onNuevo={setNuevoMaterial}
            onCambio={setMateriales}
          />

          <SeccionVariantesFijas numero={3} productoId={producto?.id ?? null} estado={versiones} />

          <section aria-label="Precio orientativo" className="flex flex-col gap-3">
            <EncabezadoDeSeccion
              numero={4}
              titulo="¿Querés darle un precio orientativo?"
              ayuda="El precio final lo ponés vos cuando cotizás."
            />
            <div className="flex flex-col gap-3 sm:pl-10">
              <div role="radiogroup" aria-label="Precio orientativo" className="flex gap-1 rounded-md border border-line bg-sunken p-1 sm:max-w-[420px]">
                {(
                  [
                    [false, "No, siempre lo cotizo"],
                    [true, "Sí, un “desde”"],
                  ] as const
                ).map(([valor, texto]) => (
                  <label
                    key={texto}
                    className={cn(OPCION_PRECIO, conDesde === valor ? "bg-card text-ink shadow-sm" : "text-ink-secondary")}
                  >
                    <input
                      type="radio"
                      name="precio-orientativo"
                      checked={conDesde === valor}
                      onChange={() => setConDesde(valor)}
                      className="sr-only"
                    />
                    {texto}
                  </label>
                ))}
              </div>
              {conDesde ? (
                <div className="sm:max-w-[260px]">
                  <label htmlFor="producto-precio-desde" className={LABEL}>
                    Precio desde
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-muted">$</span>
                    <input
                      id="producto-precio-desde"
                      inputMode="decimal"
                      value={desde}
                      placeholder="0"
                      onChange={(e) => setDesde(e.target.value)}
                      className={INPUT}
                    />
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ink-secondary">Tu asistente lo dice como referencia, nunca como precio final.</p>
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-secondary">Tu asistente le dice al cliente que el precio se lo pasás con la cotización.</p>
              )}
            </div>
          </section>

          <SeccionSolicitud numero={5} estado={solicitud} />

          <SeccionCotizacion numero={6} estado={receta} insumos={insumos} preguntas={solicitud.actuales()} />
        </div>

        {/* La vista previa: al costado desde lg; en el celular, plegada debajo de todo. */}
        <aside aria-label="Vista previa" className="hidden lg:sticky lg:top-0 lg:block">
          {vistaPrevia}
        </aside>
        <details className="rounded-lg border border-line lg:hidden">
          <summary className="cursor-pointer px-4 py-3 text-[14px] font-semibold text-primary">
            Ver cómo pregunta tu asistente
          </summary>
          <div className="px-3 pb-3">{vistaPrevia}</div>
        </details>
      </div>
    </DialogoProducto>
  );
}
