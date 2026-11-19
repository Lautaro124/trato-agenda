"use client";

import { useId, useRef, useState } from "react";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { Button } from "@/components/ui/Button";
import { FilaInterruptor } from "@/components/ui/FilaInterruptor";
import { useAvisos } from "@/components/ui/Avisos";
import { cn } from "@/lib/cn";
import { FORMATOS_FOTO } from "@/lib/imagenes";
import {
  ETIQUETA_OTRA_POR_DEFECTO,
  LARGOS,
  MAX_OPCIONES_POR_RAMA,
  nuevoId,
  opcionesDeRama,
  subirImagenPregunta,
  urlImagenPregunta,
  type OpcionPregunta,
  type PreguntaPedido,
} from "@/lib/preguntas";
import { ErrorDeApi } from "@/lib/productos";

export type ProductoElegible = { id: string; nombre: string };

const ICONO = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SEGMENTO =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 border-line bg-card px-3.5 text-[14px] font-semibold text-ink has-checked:border-primary has-checked:bg-primary-subtle has-checked:font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--color-semantic-border-focus)]";

function IconoImagen({ tamano = 18 }: Readonly<{ tamano?: number }>) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 24 24" aria-hidden="true" {...ICONO}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </svg>
  );
}

/**
 * La imagen de una pregunta o de una opción: se sube apenas se elige (la API
 * la recomprime) y queda guardada con las preguntas.
 */
function SlotImagen({
  imagenId,
  descripcion,
  onCambio,
  tamano,
}: Readonly<{ imagenId: string | null; descripcion: string; onCambio: (id: string | null) => void; tamano: "chico" | "grande" }>) {
  const { avisar } = useAvisos();
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const lado = tamano === "grande" ? "size-16" : "size-14";

  const elegir = async (archivo: File | undefined) => {
    if (!archivo) return;
    setSubiendo(true);
    try {
      onCambio(await subirImagenPregunta(archivo));
    } catch (error) {
      avisar(error instanceof ErrorDeApi ? error.message : "No pudimos subir la imagen. Probá de nuevo.", "error");
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  return (
    <div className="flex flex-none items-center gap-2">
      <input
        ref={entrada}
        type="file"
        accept={FORMATOS_FOTO}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void elegir(e.target.files?.[0])}
      />
      {imagenId ? (
        // eslint-disable-next-line @next/next/no-img-element -- la sirve la API con la cookie de sesión
        <img
          src={urlImagenPregunta(imagenId)}
          alt={`Imagen de ${descripcion}`}
          className={cn(lado, "rounded-sm border border-line object-cover")}
        />
      ) : (
        <button
          type="button"
          disabled={subiendo}
          onClick={() => entrada.current?.click()}
          aria-label={`Agregar imagen a ${descripcion}`}
          className={cn(
            lado,
            "flex flex-col items-center justify-center gap-0.5 rounded-sm border border-dashed border-line-strong bg-sunken text-[10.5px] font-semibold text-ink-secondary hover:bg-card disabled:cursor-wait",
          )}
        >
          <IconoImagen />
          {subiendo ? "Subiendo…" : "Imagen"}
        </button>
      )}
      {imagenId && (
        <div className="flex flex-col">
          <button
            type="button"
            disabled={subiendo}
            onClick={() => entrada.current?.click()}
            aria-label={`Cambiar la imagen de ${descripcion}`}
            className="min-h-8 rounded-sm px-2 text-left text-[13px] font-semibold text-link hover:bg-sunken"
          >
            {subiendo ? "Subiendo…" : "Cambiar"}
          </button>
          <button
            type="button"
            onClick={() => onCambio(null)}
            aria-label={`Quitar la imagen de ${descripcion}`}
            className="min-h-8 rounded-sm px-2 text-left text-[13px] font-semibold text-ink-secondary hover:bg-sunken"
          >
            Quitar
          </button>
        </div>
      )}
    </div>
  );
}

/** Elige productos del catálogo por nombre. */
function ElegirProductos({
  elegidos,
  productos,
  onCambio,
}: Readonly<{ elegidos: string[]; productos: ProductoElegible[]; onCambio: (ids: string[]) => void }>) {
  const id = useId();
  const [busqueda, setBusqueda] = useState("");
  const porId = new Map(productos.map((producto) => [producto.id, producto]));
  const termino = busqueda.trim().toLocaleLowerCase("es");
  const sugeridos = termino
    ? productos.filter((producto) => !elegidos.includes(producto.id) && producto.nombre.toLocaleLowerCase("es").includes(termino)).slice(0, 8)
    : [];

  return (
    <div className="flex flex-col gap-2.5">
      {elegidos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Productos elegidos">
          {elegidos.map((productoId) => {
            const nombre = porId.get(productoId)?.nombre ?? "Producto que ya no está";
            return (
              <li
                key={productoId}
                className="flex min-h-9 items-center gap-0.5 rounded-full border border-line bg-card pr-1 pl-3 text-[13.5px] font-semibold text-ink"
              >
                {nombre}
                <button
                  type="button"
                  aria-label={`Quitar ${nombre}`}
                  onClick={() => onCambio(elegidos.filter((otro) => otro !== productoId))}
                  className="grid size-8 place-items-center rounded-full text-ink-secondary hover:bg-sunken"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...ICONO} strokeWidth={2.4}>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <label htmlFor={`${id}-buscar`} className={LABEL}>
          Agregar producto
        </label>
        <input
          id={`${id}-buscar`}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscá por nombre"
          className={INPUT}
          autoComplete="off"
        />
      </div>
      {termino && (
        <ul className="flex flex-col gap-1" aria-label="Productos que coinciden">
          {sugeridos.length === 0 ? (
            <li className="text-[13px] text-ink-secondary">No hay productos con ese nombre.</li>
          ) : (
            sugeridos.map((producto) => (
              <li key={producto.id}>
                <button
                  type="button"
                  onClick={() => {
                    onCambio([...elegidos, producto.id]);
                    setBusqueda("");
                  }}
                  className="min-h-10 w-full rounded-sm px-3 text-left text-[14px] text-ink hover:bg-sunken"
                >
                  + {producto.nombre}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Una opción en la lista del editor. */
function FilaOpcion({
  opcion,
  enTodas,
  onCambio,
  onQuitar,
}: Readonly<{ opcion: OpcionPregunta; enTodas: boolean; onCambio: (opcion: OpcionPregunta) => void; onQuitar: () => void }>) {
  const nombre = opcion.texto.trim() || "esta opción";
  return (
    <li className="flex items-center gap-3 rounded-md border border-line bg-card p-2">
      <SlotImagen
        tamano="chico"
        imagenId={opcion.imagenId}
        descripcion={nombre}
        onCambio={(imagenId) => onCambio({ ...opcion, imagenId })}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          aria-label="Nombre de la opción"
          value={opcion.texto}
          maxLength={LARGOS.opcion}
          onChange={(e) => onCambio({ ...opcion, texto: e.target.value })}
          className={cn(INPUT, "py-2")}
        />
        {enTodas && <span className="text-[12px] text-ink-secondary">Se ofrece en todas las respuestas anteriores.</span>}
      </div>
      <button
        type="button"
        aria-label={`Quitar ${nombre}`}
        onClick={onQuitar}
        className="grid size-11 flex-none place-items-center rounded-md text-ink-secondary hover:bg-sunken"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...ICONO}>
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      </button>
    </li>
  );
}

/**
 * Edita una pregunta del pedido. `anteriores` son las que están antes en la
 * lista: de esas puede depender (sólo las de opciones).
 */
export function EditorPregunta({
  pregunta,
  numero,
  anteriores,
  productos,
  rama,
  onRama,
  onCambio,
  onEliminar,
}: Readonly<{
  pregunta: PreguntaPedido;
  numero: number;
  anteriores: PreguntaPedido[];
  productos: ProductoElegible[];
  /** La opción de la anterior cuyas opciones se están editando (sólo si depende de otra). */
  rama: string | null;
  onRama: (rama: string) => void;
  onCambio: (pregunta: PreguntaPedido) => void;
  onEliminar: () => void;
}>) {
  const id = useId();
  const [nuevaOpcion, setNuevaOpcion] = useState("");
  const cambiar = (cambios: Partial<PreguntaPedido>) => onCambio({ ...pregunta, ...cambios });

  const posibles = anteriores.filter((anterior) => anterior.tipo === "opciones");
  const padre = pregunta.dependeDe ? posibles.find((anterior) => anterior.id === pregunta.dependeDe?.preguntaId) : undefined;
  const ramas = padre
    ? padre.opciones.filter(
        (opcion) => pregunta.dependeDe?.siRespuestas.length === 0 || pregunta.dependeDe?.siRespuestas.includes(opcion.id),
      )
    : [];
  const ramaActiva = padre ? (ramas.find((opcion) => opcion.id === rama) ?? ramas[0] ?? null) : null;
  const visibles = padre ? (ramaActiva ? opcionesDeRama(pregunta.opciones, ramaActiva.id) : []) : pregunta.opciones;

  const agregarOpcion = () => {
    const texto = nuevaOpcion.trim().replace(/\s+/g, " ");
    if (!texto) return;
    if (visibles.some((opcion) => opcion.texto.trim().toLocaleLowerCase("es") === texto.toLocaleLowerCase("es"))) return;
    if (visibles.length >= MAX_OPCIONES_POR_RAMA) return;
    cambiar({
      opciones: [...pregunta.opciones, { id: nuevoId("o"), texto, imagenId: null, soloSi: ramaActiva ? [ramaActiva.id] : [] }],
    });
    setNuevaOpcion("");
  };

  const cambiarOpcion = (opcion: OpcionPregunta) =>
    cambiar({ opciones: pregunta.opciones.map((otra) => (otra.id === opcion.id ? opcion : otra)) });

  // Quitar en una rama: si la opción vale en varias, sólo se saca de ésta.
  const quitarOpcion = (opcion: OpcionPregunta) => {
    if (ramaActiva && opcion.soloSi.length > 1) {
      cambiarOpcion({ ...opcion, soloSi: opcion.soloSi.filter((idRama) => idRama !== ramaActiva.id) });
      return;
    }
    cambiar({ opciones: pregunta.opciones.filter((otra) => otra.id !== opcion.id) });
  };

  const textoDePregunta = pregunta.texto.trim() || `la pregunta ${numero}`;

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className="flex min-w-0 flex-col gap-6 rounded-lg border border-line bg-card p-4 shadow-md md:p-6"
    >
      <h2 id={`${id}-titulo`} className="font-display text-[18px] font-bold text-ink">
        Editar pregunta {numero}
      </h2>

      <div className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${id}-texto`} className={LABEL}>
            Pregunta
          </label>
          <input
            id={`${id}-texto`}
            value={pregunta.texto}
            maxLength={LARGOS.texto}
            placeholder="¿Qué color querés?"
            onChange={(e) => cambiar({ texto: e.target.value })}
            className={INPUT}
          />
        </div>
        <SlotImagen
          tamano="grande"
          imagenId={pregunta.imagenId}
          descripcion={textoDePregunta}
          onCambio={(imagenId) => cambiar({ imagenId })}
        />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className={LABEL}>¿Cómo responde el cliente?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["opciones", "Elige entre opciones"],
              ["texto", "Texto libre"],
            ] as const
          ).map(([tipo, titulo]) => (
            <label key={tipo} className={SEGMENTO}>
              <input
                type="radio"
                name={`${id}-tipo`}
                checked={pregunta.tipo === tipo}
                onChange={() => cambiar({ tipo, ...(tipo === "texto" ? { otra: null } : { ayuda: null }) })}
                className="sr-only"
              />
              {titulo}
            </label>
          ))}
        </div>
        {pregunta.tipo === "texto" && (
          <p className="text-[13px] text-ink-secondary">
            El cliente contesta con sus palabras y la respuesta queda completa en las notas del pedido.
          </p>
        )}
      </fieldset>

      {posibles.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div>
            <label htmlFor={`${id}-depende`} className={LABEL}>
              ¿Cuándo se pregunta?
            </label>
            <select
              id={`${id}-depende`}
              value={pregunta.dependeDe?.preguntaId ?? ""}
              onChange={(e) =>
                cambiar({
                  dependeDe: e.target.value ? { preguntaId: e.target.value, siRespuestas: [] } : null,
                  opciones: pregunta.opciones.map((opcion) => ({ ...opcion, soloSi: [] })),
                })
              }
              className={INPUT}
            >
              <option value="">Siempre, en el orden de la lista</option>
              {posibles.map((anterior) => (
                <option key={anterior.id} value={anterior.id}>
                  Después de «{anterior.texto.trim() || "pregunta sin texto"}»
                </option>
              ))}
            </select>
          </div>
          {padre && (
            <fieldset className="flex flex-col gap-2 rounded-md bg-sunken p-3">
              <legend className="sr-only">Respuestas que activan esta pregunta</legend>
              <p className="text-[13px] text-ink-secondary">
                Sólo si eligió (sin marcar ninguna, con cualquiera). Si el cliente cambia esa respuesta, se vuelve a preguntar.
              </p>
              <div className="flex flex-wrap gap-2">
                {padre.opciones.map((opcion) => {
                  const marcada = pregunta.dependeDe?.siRespuestas.includes(opcion.id) ?? false;
                  return (
                    <label key={opcion.id} className={SEGMENTO}>
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() =>
                          cambiar({
                            dependeDe: {
                              preguntaId: padre.id,
                              siRespuestas: marcada
                                ? (pregunta.dependeDe?.siRespuestas ?? []).filter((otra) => otra !== opcion.id)
                                : [...(pregunta.dependeDe?.siRespuestas ?? []), opcion.id],
                            },
                          })
                        }
                        className="size-4 accent-[var(--color-semantic-primary-default)]"
                      />
                      {opcion.texto || "Opción sin nombre"}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      )}

      <fieldset className="flex min-w-0 flex-col gap-2.5">
        <legend className={LABEL}>¿En qué pedidos se pregunta?</legend>
        {padre ? (
          <p className="rounded-md bg-sunken px-3.5 py-3 text-[14px] text-ink">
            En los mismos que «{padre.texto.trim() || "la pregunta anterior"}».
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["global", "En todos, una vez por pedido"],
                  ["producto", "Sólo con ciertos productos"],
                ] as const
              ).map(([alcance, titulo]) => (
                <label key={alcance} className={SEGMENTO}>
                  <input
                    type="radio"
                    name={`${id}-alcance`}
                    checked={pregunta.alcance === alcance}
                    onChange={() => cambiar({ alcance })}
                    className="sr-only"
                  />
                  {titulo}
                </label>
              ))}
            </div>
            {pregunta.alcance === "producto" ? (
              <>
                <p className="text-[13px] text-ink-secondary">
                  Se hace por cada uno de estos productos y la respuesta queda en ese producto del pedido.
                </p>
                <ElegirProductos
                  elegidos={pregunta.productos}
                  productos={productos}
                  onCambio={(ids) => cambiar({ productos: ids })}
                />
              </>
            ) : (
              <p className="text-[13px] text-ink-secondary">Se hace una sola vez por pedido, tenga los productos que tenga.</p>
            )}
          </>
        )}
      </fieldset>

      {pregunta.tipo === "opciones" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            <div>
              <h3 className="text-[13px] font-semibold text-ink-secondary">Opciones</h3>
              <p className="text-[13px] text-ink-secondary">Cada opción puede tener su imagen: el asistente la manda con su nombre.</p>
            </div>
            {padre && (
              <div role="group" aria-label="Respuesta anterior" className="flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
                <span className="mr-1 text-[13px] text-ink-secondary">Si eligió</span>
                {ramas.map((opcion) => (
                  <button
                    key={opcion.id}
                    type="button"
                    aria-pressed={ramaActiva?.id === opcion.id}
                    onClick={() => onRama(opcion.id)}
                    className={cn(
                      "min-h-9 rounded-full border px-3.5 text-[13.5px] font-semibold",
                      ramaActiva?.id === opcion.id
                        ? "border-primary bg-primary-subtle text-primary-active"
                        : "border-line bg-card text-ink hover:bg-sunken",
                    )}
                  >
                    {opcion.texto || "Opción sin nombre"}
                  </button>
                ))}
              </div>
            )}
            {padre && ramas.length === 0 ? (
              <p className="text-[13px] text-ink-secondary">La pregunta anterior todavía no tiene opciones.</p>
            ) : (
              <>
                {/* Con el editor ancho, las opciones se acomodan en columnas. */}
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2">
                  {visibles.map((opcion) => (
                    <FilaOpcion
                      key={opcion.id}
                      opcion={opcion}
                      enTodas={padre !== undefined && opcion.soloSi.length === 0}
                      onCambio={cambiarOpcion}
                      onQuitar={() => quitarOpcion(opcion)}
                    />
                  ))}
                </ul>
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`${id}-nueva`} className={LABEL}>
                      Nueva opción{ramaActiva ? ` para ${ramaActiva.texto.toLocaleLowerCase("es")}` : ""}
                    </label>
                    <input
                      id={`${id}-nueva`}
                      value={nuevaOpcion}
                      maxLength={LARGOS.opcion}
                      onChange={(e) => setNuevaOpcion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          agregarOpcion();
                        }
                      }}
                      className={INPUT}
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={agregarOpcion} disabled={!nuevaOpcion.trim()}>
                    Agregar
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2.5 rounded-md bg-sunken p-1">
            <FilaInterruptor
              titulo="Aceptar otra opción"
              ayuda="Si el cliente pide algo fuera de la lista, queda como nota en el pedido. No se agrega al catálogo ni se le confirma."
              checked={pregunta.otra !== null}
              onChange={(activa) => cambiar({ otra: activa ? { etiqueta: "Personalizar" } : null })}
            />
            {pregunta.otra && (
              <div className="px-3 pb-3">
                <label htmlFor={`${id}-otra`} className={LABEL}>
                  Cómo se llama la opción
                </label>
                <input
                  id={`${id}-otra`}
                  value={pregunta.otra.etiqueta}
                  maxLength={LARGOS.etiqueta}
                  placeholder={ETIQUETA_OTRA_POR_DEFECTO}
                  onChange={(e) => cambiar({ otra: { etiqueta: e.target.value } })}
                  className={cn(INPUT, "max-w-72")}
                />
              </div>
            )}
          </div>
          <FilaInterruptor
            titulo="Obligatoria"
            ayuda="El pedido no se crea sin esta respuesta."
            checked={pregunta.obligatoria}
            onChange={(obligatoria) => cambiar({ obligatoria })}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={`${id}-ayuda`} className={LABEL}>
              Ayuda para el cliente (opcional)
            </label>
            <input
              id={`${id}-ayuda`}
              value={pregunta.ayuda ?? ""}
              maxLength={LARGOS.ayuda}
              placeholder="Ej.: medidas, dedicatoria, horario para recibirlo"
              onChange={(e) => cambiar({ ayuda: e.target.value })}
              className={INPUT}
            />
          </div>
          <FilaInterruptor
            titulo="Se puede saltear"
            ayuda="Si el cliente dice que no tiene nada para agregar, el pedido sigue sin nota."
            checked={!pregunta.obligatoria}
            onChange={(saltear) => cambiar({ obligatoria: !saltear })}
          />
        </div>
      )}

      <div>
        <Button type="button" variant="ghost" onClick={onEliminar} className="text-danger-text hover:bg-danger-subtle">
          Eliminar pregunta
        </Button>
      </div>
    </section>
  );
}
