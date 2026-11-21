"use client";

import { useId, useState, type ReactNode } from "react";
import { ElegirProductos, SEGMENTO, type ProductoElegible } from "@/components/preguntas/EditorPregunta";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import { Button } from "@/components/ui/Button";
import { FilaInterruptor } from "@/components/ui/FilaInterruptor";
import { cn } from "@/lib/cn";
import type { PreguntaPedido } from "@/lib/preguntas";
import {
  ETIQUETA_ACCION,
  LARGOS,
  MAX_EJEMPLOS,
  MAX_PROPIEDADES_POR_ELEMENTO,
  claveDeElemento,
  preguntasConOpciones,
  propiedadesDe,
  type Accion,
  type ConfiguracionRecomendaciones,
  type Elemento,
  type Excepcion,
  type Propiedad,
  type Recomendacion,
} from "@/lib/recomendaciones";

const ICONO = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const TARJETA = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5 md:p-6";
const TITULO = "font-display text-[19px] font-bold text-ink";
const AYUDA = "text-[14px] leading-[1.5] text-ink-secondary";
const CHECK = "size-4 flex-none accent-[var(--color-semantic-primary-hover)]";

function Seccion({ id, titulo, ayuda, children }: Readonly<{ id: string; titulo: string; ayuda?: string; children: ReactNode }>) {
  return (
    <section aria-labelledby={id} className={TARJETA}>
      <div className="flex flex-col gap-1">
        <h2 id={id} className={TITULO}>
          {titulo}
        </h2>
        {ayuda && <p className={AYUDA}>{ayuda}</p>}
      </div>
      {children}
    </section>
  );
}

function Quitar({ etiqueta, onClick }: Readonly<{ etiqueta: string; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={onClick}
      className="grid size-11 flex-none place-items-center rounded-full text-ink-secondary hover:bg-sunken"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...ICONO} strokeWidth={2.4}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/** Opciones de una pregunta con casillas: vacío = todas. */
function ElegirOpciones({
  pregunta,
  elegidas,
  onCambio,
  leyenda,
  ayudaVacio,
}: Readonly<{ pregunta: PreguntaPedido; elegidas: string[]; onCambio: (ids: string[]) => void; leyenda: string; ayudaVacio: string }>) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[14px] font-semibold text-ink">{leyenda}</legend>
      <div className="flex flex-wrap gap-2">
        {pregunta.opciones.map((opcion) => (
          <label key={opcion.id} className={SEGMENTO}>
            <input
              type="checkbox"
              className={CHECK}
              checked={elegidas.includes(opcion.id)}
              onChange={(e) =>
                onCambio(e.target.checked ? [...elegidas, opcion.id] : elegidas.filter((id) => id !== opcion.id))
              }
            />
            {opcion.texto}
          </label>
        ))}
      </div>
      {elegidas.length === 0 && <p className="text-[13px] text-ink-secondary">{ayudaVacio}</p>}
    </fieldset>
  );
}

function ElegirPregunta({
  preguntas,
  valor,
  onCambio,
  etiqueta,
}: Readonly<{ preguntas: PreguntaPedido[]; valor: string; onCambio: (id: string) => void; etiqueta: string }>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {etiqueta}
      </label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value)} className={INPUT}>
        <option value="">Elegí una pregunta</option>
        {preguntas.map((pregunta) => (
          <option key={pregunta.id} value={pregunta.id}>
            {pregunta.texto.trim() || "Pregunta sin texto"}
          </option>
        ))}
      </select>
    </div>
  );
}

function Ejemplos({ ejemplos, onCambio }: Readonly<{ ejemplos: string[]; onCambio: (ejemplos: string[]) => void }>) {
  const id = useId();
  const [nuevo, setNuevo] = useState("");
  const agregar = () => {
    const texto = nuevo.trim();
    if (!texto || ejemplos.length >= MAX_EJEMPLOS) return;
    if (!ejemplos.some((otro) => otro.toLocaleLowerCase("es") === texto.toLocaleLowerCase("es"))) onCambio([...ejemplos, texto]);
    setNuevo("");
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-semibold text-ink">
        Ejemplos de mensajes <span className="font-normal text-ink-secondary">(opcional)</span>
      </span>
      {ejemplos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Ejemplos">
          {ejemplos.map((ejemplo) => (
            <li key={ejemplo} className="flex min-h-9 items-center gap-0.5 rounded-full bg-sunken pr-0 pl-3 text-[13.5px] font-semibold text-ink">
              «{ejemplo}»
              <Quitar etiqueta={`Quitar el ejemplo ${ejemplo}`} onClick={() => onCambio(ejemplos.filter((otro) => otro !== ejemplo))} />
            </li>
          ))}
        </ul>
      )}
      {ejemplos.length < MAX_EJEMPLOS && (
        <div className="flex flex-wrap gap-2">
          <label htmlFor={id} className="sr-only">
            Nuevo ejemplo
          </label>
          <input
            id={id}
            value={nuevo}
            maxLength={LARGOS.ejemplo}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar();
              }
            }}
            placeholder="Por ejemplo: no puedo despegar los soportes"
            className={cn(INPUT, "min-w-0 flex-1")}
          />
          <Button type="button" variant="secondary" onClick={agregar} disabled={!nuevo.trim()}>
            Agregar
          </Button>
        </div>
      )}
    </div>
  );
}

/** Las propiedades de un producto u opción: filas de nombre y valor. */
function EditorPropiedades({
  titulo,
  propiedades,
  onCambio,
}: Readonly<{ titulo: string; propiedades: Propiedad[]; onCambio: (propiedades: Propiedad[]) => void }>) {
  const filas = propiedades.length > 0 ? propiedades : [];
  const cambiar = (indice: number, propiedad: Propiedad) => onCambio(filas.map((otra, i) => (i === indice ? propiedad : otra)));
  return (
    <div className="flex flex-col gap-2.5 rounded-md bg-sunken p-4">
      <span className="text-[14px] font-bold text-ink">{titulo}</span>
      {filas.length === 0 && <p className="text-[13px] text-ink-secondary">Sin propiedades cargadas.</p>}
      {filas.map((propiedad, indice) => (
        <div key={indice} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
          <input
            aria-label={`Propiedad ${indice + 1} de ${titulo}`}
            value={propiedad.nombre}
            maxLength={LARGOS.propiedadNombre}
            placeholder="Solubilidad"
            onChange={(e) => cambiar(indice, { ...propiedad, nombre: e.target.value })}
            className={INPUT}
          />
          <input
            aria-label={`Valor de la propiedad ${indice + 1} de ${titulo}`}
            value={propiedad.valor}
            maxLength={LARGOS.propiedadValor}
            placeholder="En agua tibia"
            onChange={(e) => cambiar(indice, { ...propiedad, valor: e.target.value })}
            className={INPUT}
          />
          <Quitar
            etiqueta={`Quitar ${propiedad.nombre.trim() || "la propiedad"}`}
            onClick={() => onCambio(filas.filter((_, i) => i !== indice))}
          />
        </div>
      ))}
      {filas.length < MAX_PROPIEDADES_POR_ELEMENTO && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onCambio([...filas, { nombre: "", valor: "" }])}>
            + Agregar propiedad
          </Button>
        </div>
      )}
    </div>
  );
}

function EditorExcepcion({
  excepcion,
  nombre,
  candidatosProducto,
  candidatosOpcion,
  onCambio,
  onQuitar,
}: Readonly<{
  excepcion: Excepcion;
  nombre: string;
  candidatosProducto: ProductoElegible[];
  candidatosOpcion: Array<{ id: string; texto: string }>;
  onCambio: (excepcion: Excepcion) => void;
  onQuitar: () => void;
}>) {
  const id = useId();
  const alternar = (lista: string[], valor: string, si: boolean) => (si ? [...lista, valor] : lista.filter((otro) => otro !== valor));
  return (
    <li className="flex flex-col gap-3 rounded-md border border-primary bg-primary-subtle/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14.5px] font-bold text-ink">{nombre}</span>
        <Quitar etiqueta={`Quitar la excepción de ${nombre}`} onClick={onQuitar} />
      </div>
      {(candidatosProducto.length > 0 || candidatosOpcion.length > 0) && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13.5px] font-semibold text-ink">No recomendar en este producto</legend>
          <div className="flex flex-wrap gap-2">
            {candidatosProducto.map((producto) => (
              <label key={producto.id} className={SEGMENTO}>
                <input
                  type="checkbox"
                  className={CHECK}
                  checked={excepcion.excluirProductos.includes(producto.id)}
                  onChange={(e) => onCambio({ ...excepcion, excluirProductos: alternar(excepcion.excluirProductos, producto.id, e.target.checked) })}
                />
                {producto.nombre}
              </label>
            ))}
            {candidatosOpcion.map((opcion) => (
              <label key={opcion.id} className={SEGMENTO}>
                <input
                  type="checkbox"
                  className={CHECK}
                  checked={excepcion.excluirOpciones.includes(opcion.id)}
                  onChange={(e) => onCambio({ ...excepcion, excluirOpciones: alternar(excepcion.excluirOpciones, opcion.id, e.target.checked) })}
                />
                {opcion.texto}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <label htmlFor={`${id}-nota`} className={LABEL}>
          Aclaración para este producto (opcional)
        </label>
        <input
          id={`${id}-nota`}
          value={excepcion.nota ?? ""}
          maxLength={LARGOS.nota}
          placeholder="Este modelo no se hace en Pana."
          onChange={(e) => onCambio({ ...excepcion, nota: e.target.value || null })}
          className={INPUT}
        />
      </div>
    </li>
  );
}

const ACCIONES: Accion["tipo"][] = ["responder", "preguntar", "recomendar", "continuar"];

function accionVacia(tipo: Accion["tipo"]): Accion {
  if (tipo === "responder") return { tipo, texto: "" };
  if (tipo === "preguntar") return { tipo, pregunta: "" };
  if (tipo === "continuar") return { tipo, preguntaId: "" };
  return { tipo, productos: [], opciones: null, criterio: null };
}

export function EditorRecomendacion({
  regla,
  configuracion,
  preguntas,
  productos,
  onCambio,
  onPropiedades,
  onEliminar,
}: Readonly<{
  regla: Recomendacion;
  configuracion: ConfiguracionRecomendaciones;
  preguntas: PreguntaPedido[];
  productos: ProductoElegible[];
  onCambio: (regla: Recomendacion) => void;
  onPropiedades: (elemento: Elemento, propiedades: Propiedad[]) => void;
  onEliminar: () => void;
}>) {
  const id = useId();
  const [excepcionNueva, setExcepcionNueva] = useState("");
  const conOpciones = preguntasConOpciones(preguntas);
  const porId = new Map(productos.map((producto) => [producto.id, producto]));
  const nombreDe = (productoId: string) => porId.get(productoId)?.nombre ?? "Producto que ya no está";
  const cambiar = (parcial: Partial<Recomendacion>) => onCambio({ ...regla, ...parcial });
  const { disparador, accion } = regla;

  const preguntaDelPaso = disparador.tipo === "paso" ? conOpciones.find((p) => p.id === disparador.preguntaId) : undefined;
  const necesidadActual = disparador.tipo === "paso" ? { necesidad: "", ejemplos: [] } : { necesidad: disparador.necesidad, ejemplos: disparador.ejemplos };

  /**
   * Al activarse en una pregunta, lo natural es recomendar sus opciones: si la
   * acción es recomendar y no apunta a otra pregunta elegida a mano, apunta a ésa.
   */
  const enPregunta = (preguntaId: string, anterior: string | null) => {
    const sigueLaPregunta =
      accion.tipo === "recomendar" && (!accion.opciones || accion.opciones.preguntaId === anterior);
    cambiar({
      disparador: { tipo: "pregunta", preguntaId, ...necesidadActual },
      ...(sigueLaPregunta && accion.tipo === "recomendar" && preguntaId
        ? { accion: { ...accion, opciones: { preguntaId, opcionIds: accion.opciones?.preguntaId === preguntaId ? accion.opciones.opcionIds : [] } } }
        : {}),
    });
  };
  const preguntaDeOpciones =
    accion.tipo === "recomendar" && accion.opciones ? conOpciones.find((p) => p.id === accion.opciones?.preguntaId) : undefined;
  const opcionesCandidatas =
    accion.tipo === "recomendar" && accion.opciones && preguntaDeOpciones
      ? preguntaDeOpciones.opciones.filter((o) => accion.opciones?.opcionIds.length === 0 || accion.opciones?.opcionIds.includes(o.id))
      : [];

  // Lo que consulta el asistente: los productos que puede recomendar, los vinculados y las opciones.
  const elementos: Array<{ elemento: Elemento; titulo: string }> = [];
  const vistos = new Set<string>();
  const sumar = (elemento: Elemento, titulo: string) => {
    const clave = claveDeElemento(elemento);
    if (vistos.has(clave)) return;
    vistos.add(clave);
    elementos.push({ elemento, titulo });
  };
  if (accion.tipo === "recomendar") for (const productoId of accion.productos) sumar({ tipo: "producto", productoId }, `${nombreDe(productoId)} · producto completo`);
  for (const productoId of regla.productos.slice(0, 20)) sumar({ tipo: "producto", productoId }, `${nombreDe(productoId)} · producto completo`);
  if (preguntaDeOpciones) {
    for (const opcion of opcionesCandidatas) {
      sumar({ tipo: "opcion", preguntaId: preguntaDeOpciones.id, opcionId: opcion.id }, `Opción «${opcion.texto}» de ${preguntaDeOpciones.texto}`);
    }
  }

  const sinExcepcion = regla.productos.filter((productoId) => !regla.excepciones.some((e) => e.productoId === productoId));

  return (
    <div className="flex flex-col gap-5">
      <Seccion id={`${id}-nombre`} titulo="Nombre">
        <div>
          <label htmlFor={`${id}-nombre-input`} className={LABEL}>
            Nombre interno
          </label>
          <input
            id={`${id}-nombre-input`}
            value={regla.nombre}
            maxLength={LARGOS.nombre}
            placeholder="Soportes solubles"
            onChange={(e) => cambiar({ nombre: e.target.value })}
            className={INPUT}
          />
          <p className="mt-1.5 text-[13px] text-ink-secondary">Sólo lo ves vos. El cliente nunca lee este nombre.</p>
        </div>
        <FilaInterruptor
          titulo="Activa en WhatsApp"
          ayuda="Pausada, el asistente no la usa con tus clientes, pero podés probarla igual."
          checked={regla.activa}
          onChange={(activa) => cambiar({ activa })}
        />
      </Seccion>

      <Seccion id={`${id}-cuando`} titulo="Cuándo se activa">
        <div role="radiogroup" aria-labelledby={`${id}-cuando`} className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["consulta", "Cuando el cliente consulta algo", "Describís la necesidad en tus palabras. Sirve para preguntas espontáneas."],
              [
                "pregunta",
                "Mientras responde una pregunta",
                "Le preguntás, por ejemplo, la tela y te cuenta que tiene mascotas: le recomienda una de las opciones.",
              ],
              ["paso", "Después de un paso del pedido", "Elegís una pregunta y, si querés, la respuesta que la activa."],
            ] as const
          ).map(([tipo, titulo, detalle]) => (
            <label
              key={tipo}
              className="flex cursor-pointer flex-col gap-1 rounded-md border-2 border-line bg-card p-4 has-checked:border-primary has-checked:bg-primary-subtle has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--color-semantic-border-focus)]"
            >
              <span className="flex items-center gap-2 text-[15px] font-bold text-ink">
                <input
                  type="radio"
                  name={`${id}-disparador`}
                  className={CHECK}
                  checked={disparador.tipo === tipo}
                  disabled={tipo !== "consulta" && conOpciones.length === 0}
                  onChange={() => {
                    if (tipo === "pregunta") {
                      enPregunta(conOpciones[0]?.id ?? "", null);
                      return;
                    }
                    cambiar({
                      disparador:
                        tipo === "consulta"
                          ? { tipo: "consulta", ...necesidadActual }
                          : { tipo: "paso", preguntaId: conOpciones[0]?.id ?? "", opciones: [] },
                    });
                  }}
                />
                {titulo}
              </span>
              <span className="text-[13px] leading-[1.45] text-ink-secondary">
                {tipo !== "consulta" && conOpciones.length === 0 ? "Primero creá una pregunta con opciones en Preguntas." : detalle}
              </span>
            </label>
          ))}
        </div>

        {disparador.tipo === "consulta" && (
          <>
            <div>
              <label htmlFor={`${id}-necesidad`} className={LABEL}>
                Qué necesita el cliente
              </label>
              <textarea
                id={`${id}-necesidad`}
                rows={2}
                value={disparador.necesidad}
                maxLength={LARGOS.necesidad}
                placeholder="Quiere retirar soportes que le cuesta despegar de la pieza."
                onChange={(e) => cambiar({ disparador: { ...disparador, necesidad: e.target.value } })}
                className={cn(INPUT, "min-h-[72px] py-2.5 leading-[1.5]")}
              />
              <p className="mt-1.5 text-[13px] text-ink-secondary">
                Escribilo como se lo contarías a alguien del local. El asistente reconoce otras formas de decir lo mismo.
              </p>
            </div>
            <Ejemplos ejemplos={disparador.ejemplos} onCambio={(ejemplos) => cambiar({ disparador: { ...disparador, ejemplos } })} />
          </>
        )}

        {disparador.tipo === "pregunta" && (
          <>
            <ElegirPregunta
              preguntas={conOpciones}
              valor={disparador.preguntaId}
              etiqueta="Mientras le pregunta"
              onCambio={(preguntaId) => enPregunta(preguntaId, disparador.preguntaId)}
            />
            <div>
              <label htmlFor={`${id}-necesidad-pregunta`} className={LABEL}>
                Qué cuenta el cliente en vez de elegir
              </label>
              <textarea
                id={`${id}-necesidad-pregunta`}
                rows={2}
                value={disparador.necesidad}
                maxLength={LARGOS.necesidad}
                placeholder="Tiene mascotas y le preocupa que arañen o llenen de pelos el sillón."
                onChange={(e) => cambiar({ disparador: { ...disparador, necesidad: e.target.value } })}
                className={cn(INPUT, "min-h-[72px] py-2.5 leading-[1.5]")}
              />
              <p className="mt-1.5 text-[13px] text-ink-secondary">
                También se activa si le pide ayuda para elegir por ese motivo. Después de recomendar, el asistente le pregunta
                cuál quiere y la toma como su respuesta.
              </p>
            </div>
            <Ejemplos ejemplos={disparador.ejemplos} onCambio={(ejemplos) => cambiar({ disparador: { ...disparador, ejemplos } })} />
          </>
        )}

        {disparador.tipo === "paso" && (
          <>
            <ElegirPregunta
              preguntas={conOpciones}
              valor={disparador.preguntaId}
              etiqueta="Después de la pregunta"
              onCambio={(preguntaId) => cambiar({ disparador: { tipo: "paso", preguntaId, opciones: [] } })}
            />
            {preguntaDelPaso && (
              <ElegirOpciones
                pregunta={preguntaDelPaso}
                elegidas={disparador.opciones}
                leyenda="Si responde"
                ayudaVacio="Sin marcar ninguna, se activa con cualquier respuesta."
                onCambio={(opciones) => cambiar({ disparador: { ...disparador, opciones } })}
              />
            )}
            <p className={AYUDA}>Si el cliente cambia la respuesta, el asistente vuelve a evaluar esta regla.</p>
          </>
        )}
      </Seccion>

      <Seccion id={`${id}-productos`} titulo="Productos vinculados" ayuda="Dónde aplica. Si editás la regla, cambia en todos los productos vinculados.">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Alcance</legend>
          {(
            [
              ["producto", "Sólo estos productos"],
              ["global", "Todo el catálogo"],
            ] as const
          ).map(([alcance, etiqueta]) => (
            <label key={alcance} className={SEGMENTO}>
              <input
                type="radio"
                name={`${id}-alcance`}
                className={CHECK}
                checked={regla.alcance === alcance}
                onChange={() => cambiar({ alcance, productos: alcance === "global" ? [] : regla.productos, excepciones: alcance === "global" ? [] : regla.excepciones })}
              />
              {etiqueta}
            </label>
          ))}
        </fieldset>
        {regla.alcance === "producto" && (
          <ElegirProductos
            elegidos={regla.productos}
            productos={productos}
            onCambio={(ids) => cambiar({ productos: ids, excepciones: regla.excepciones.filter((e) => ids.includes(e.productoId)) })}
          />
        )}
      </Seccion>

      <Seccion id={`${id}-hace`} titulo="Qué hace el asistente">
        <div role="radiogroup" aria-labelledby={`${id}-hace`} className="flex flex-wrap gap-2">
          {ACCIONES.map((tipo) => (
            <label key={tipo} className={SEGMENTO}>
              <input
                type="radio"
                name={`${id}-accion`}
                className={CHECK}
                checked={accion.tipo === tipo}
                disabled={tipo === "continuar" && preguntas.length === 0}
                onChange={() => cambiar({ accion: accionVacia(tipo) })}
              />
              {ETIQUETA_ACCION[tipo]}
            </label>
          ))}
        </div>

        {accion.tipo === "responder" && (
          <div>
            <label htmlFor={`${id}-texto`} className={LABEL}>
              Respuesta
            </label>
            <textarea
              id={`${id}-texto`}
              rows={3}
              value={accion.texto}
              maxLength={LARGOS.texto}
              onChange={(e) => cambiar({ accion: { ...accion, texto: e.target.value } })}
              className={cn(INPUT, "min-h-[88px] py-2.5 leading-[1.5]")}
            />
            <p className="mt-1.5 text-[13px] text-ink-secondary">El asistente la adapta al tono de la charla, sin agregar datos.</p>
          </div>
        )}

        {accion.tipo === "preguntar" && (
          <div>
            <label htmlFor={`${id}-pregunta`} className={LABEL}>
              Pregunta
            </label>
            <input
              id={`${id}-pregunta`}
              value={accion.pregunta}
              maxLength={LARGOS.pregunta}
              placeholder="¿Buscás soportes que se disuelvan o que se separen a mano?"
              onChange={(e) => cambiar({ accion: { ...accion, pregunta: e.target.value } })}
              className={INPUT}
            />
          </div>
        )}

        {accion.tipo === "continuar" && (
          <ElegirPregunta
            preguntas={preguntas}
            valor={accion.preguntaId}
            etiqueta="Continuar con la pregunta"
            onCambio={(preguntaId) => cambiar({ accion: { tipo: "continuar", preguntaId } })}
          />
        )}

        {accion.tipo === "recomendar" && (
          <div className="flex flex-col gap-4">
            <p className={AYUDA}>
              Recomienda sólo lo que esté disponible y explica por qué sirve con las propiedades que cargues abajo.
            </p>
            <div className="flex flex-col gap-2">
              <span className="text-[14px] font-semibold text-ink">Productos que puede recomendar</span>
              {regla.productos.length > 0 && (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => cambiar({ accion: { ...accion, productos: [...new Set([...accion.productos, ...regla.productos])] } })}
                  >
                    Usar los productos vinculados
                  </Button>
                </div>
              )}
              <ElegirProductos
                elegidos={accion.productos}
                productos={productos}
                onCambio={(ids) => cambiar({ accion: { ...accion, productos: ids } })}
              />
            </div>
            {conOpciones.length > 0 && (
              <div className="flex flex-col gap-3">
                <ElegirPregunta
                  preguntas={conOpciones}
                  valor={accion.opciones?.preguntaId ?? ""}
                  etiqueta="Opciones que puede recomendar (opcional)"
                  onCambio={(preguntaId) => cambiar({ accion: { ...accion, opciones: preguntaId ? { preguntaId, opcionIds: [] } : null } })}
                />
                {preguntaDeOpciones && accion.opciones && (
                  <ElegirOpciones
                    pregunta={preguntaDeOpciones}
                    elegidas={accion.opciones.opcionIds}
                    leyenda="Cuáles"
                    ayudaVacio="Sin marcar ninguna, puede recomendar cualquiera de esas opciones."
                    onCambio={(opcionIds) =>
                      cambiar({ accion: { ...accion, opciones: { preguntaId: preguntaDeOpciones.id, opcionIds } } })
                    }
                  />
                )}
              </div>
            )}
            <div>
              <label htmlFor={`${id}-criterio`} className={LABEL}>
                En qué casos aplica cada uno (opcional)
              </label>
              <input
                id={`${id}-criterio`}
                value={accion.criterio ?? ""}
                maxLength={LARGOS.criterio}
                placeholder="PVA para PLA; BVOH si la pieza es de nylon."
                onChange={(e) => cambiar({ accion: { ...accion, criterio: e.target.value || null } })}
                className={INPUT}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-md border border-line p-4">
          <div className="flex items-start gap-3">
            <input
              id={`${id}-con-requisito`}
              type="checkbox"
              aria-describedby={`${id}-con-requisito-ayuda`}
              className={cn(CHECK, "mt-1")}
              checked={regla.requisito !== null}
              onChange={(e) => cambiar({ requisito: e.target.checked ? { dato: "", pregunta: "", siNoCumple: "explicar" } : null })}
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor={`${id}-con-requisito`} className="cursor-pointer text-[14px] font-semibold text-ink">
                Necesita un dato antes
              </label>
              <span id={`${id}-con-requisito-ayuda`} className="text-[13px] leading-[1.5] text-ink-secondary">
                Si falta un dato que cambia la respuesta, el asistente lo pregunta antes de confirmar.
              </span>
            </div>
          </div>
          {regla.requisito && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor={`${id}-dato`} className={LABEL}>
                  Dato
                </label>
                <input
                  id={`${id}-dato`}
                  value={regla.requisito.dato}
                  maxLength={LARGOS.dato}
                  placeholder="La impresora imprime con dos materiales"
                  onChange={(e) => cambiar({ requisito: { ...(regla.requisito as NonNullable<Recomendacion["requisito"]>), dato: e.target.value } })}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor={`${id}-pide`} className={LABEL}>
                  Si falta, preguntar
                </label>
                <input
                  id={`${id}-pide`}
                  value={regla.requisito.pregunta}
                  maxLength={LARGOS.pregunta}
                  placeholder="¿Tu impresora tiene doble extrusor?"
                  onChange={(e) => cambiar({ requisito: { ...(regla.requisito as NonNullable<Recomendacion["requisito"]>), pregunta: e.target.value } })}
                  className={INPUT}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor={`${id}-no`} className={LABEL}>
                  Si no lo cumple
                </label>
                <select
                  id={`${id}-no`}
                  value={regla.requisito.siNoCumple}
                  onChange={(e) =>
                    cambiar({
                      requisito: {
                        ...(regla.requisito as NonNullable<Recomendacion["requisito"]>),
                        siNoCumple: e.target.value === "derivar" ? "derivar" : "explicar",
                      },
                    })
                  }
                  className={INPUT}
                >
                  <option value="explicar">Explicarle que hace falta y no recomendar</option>
                  <option value="derivar">Pasarte la conversación</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <FilaInterruptor
          titulo="Retomar el pedido"
          ayuda="Si el cliente estaba armando un pedido, después de esto sigue con el paso pendiente."
          checked={regla.retomarPedido}
          onChange={(retomarPedido) => cambiar({ retomarPedido })}
        />
      </Seccion>

      {elementos.length > 0 && (
        <Seccion
          id={`${id}-props`}
          titulo="Propiedades que consulta el asistente"
          ayuda="Con estos datos elige y explica por qué recomienda algo. Un dato de una opción queda en esa opción: no se le atribuye al producto entero. Las propiedades se comparten entre recomendaciones."
        >
          {elementos.map(({ elemento, titulo }) => (
            <EditorPropiedades
              key={claveDeElemento(elemento)}
              titulo={titulo}
              propiedades={propiedadesDe(configuracion, elemento)}
              onCambio={(propiedades) => onPropiedades(elemento, propiedades)}
            />
          ))}
        </Seccion>
      )}

      {regla.alcance === "producto" && regla.productos.length > 1 && accion.tipo === "recomendar" && (
        <Seccion
          id={`${id}-excepciones`}
          titulo="Excepciones por producto"
          ayuda="Para un modelo puntual: no recomendar algo o agregar una aclaración. El resto sigue usando la regla."
        >
          {regla.excepciones.length > 0 && (
            <ul className="flex flex-col gap-3">
              {regla.excepciones.map((excepcion) => (
                <EditorExcepcion
                  key={excepcion.productoId}
                  excepcion={excepcion}
                  nombre={nombreDe(excepcion.productoId)}
                  candidatosProducto={accion.productos.map((productoId) => ({ id: productoId, nombre: nombreDe(productoId) }))}
                  candidatosOpcion={opcionesCandidatas}
                  onCambio={(cambiada) =>
                    cambiar({ excepciones: regla.excepciones.map((otra) => (otra.productoId === cambiada.productoId ? cambiada : otra)) })
                  }
                  onQuitar={() => cambiar({ excepciones: regla.excepciones.filter((otra) => otra.productoId !== excepcion.productoId) })}
                />
              ))}
            </ul>
          )}
          {sinExcepcion.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor={`${id}-excepcion`} className={LABEL}>
                  Agregar excepción para
                </label>
                <select id={`${id}-excepcion`} value={excepcionNueva} onChange={(e) => setExcepcionNueva(e.target.value)} className={INPUT}>
                  <option value="">Elegí un producto</option>
                  {sinExcepcion.map((productoId) => (
                    <option key={productoId} value={productoId}>
                      {nombreDe(productoId)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={!excepcionNueva}
                onClick={() => {
                  cambiar({
                    excepciones: [...regla.excepciones, { productoId: excepcionNueva, excluirProductos: [], excluirOpciones: [], nota: null }],
                  });
                  setExcepcionNueva("");
                }}
              >
                Agregar
              </Button>
            </div>
          )}
        </Seccion>
      )}

      <div>
        <button
          type="button"
          onClick={onEliminar}
          className="inline-flex min-h-11 items-center rounded-md px-4 text-[15px] font-semibold text-danger-text hover:bg-danger-subtle"
        >
          Eliminar recomendación
        </button>
      </div>
    </div>
  );
}
