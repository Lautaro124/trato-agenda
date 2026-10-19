"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ListaDePastillas } from "@/components/productos/ListaDePastillas";
import { cn } from "@/lib/cn";
import {
  LARGO_MAX_OPCION,
  LARGO_MAX_PREGUNTA,
  LARGO_MAX_UNIDAD_PREGUNTA,
  MAX_OPCIONES,
  MAX_PREGUNTAS,
  claveDeTexto,
  enUnaLinea,
  problemaDePregunta,
  problemaDeSolicitud,
  variableDesdeTexto,
  type PreguntaSolicitud,
  type SobrePregunta,
  type SolicitudADemanda,
} from "@/lib/solicitud";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1.5 block text-[12.5px] font-semibold text-ink-secondary";

/** Ideas para arrancar: tocarlas suma la pregunta ya escrita. */
const IDEAS_DE_PREGUNTAS: ReadonlyArray<{ texto: string; opciones: string[] }> = [
  { texto: "¿Qué medidas necesitás?", opciones: [] },
  { texto: "¿De qué color lo querés?", opciones: [] },
  { texto: "¿Cuántas unidades necesitás?", opciones: [] },
  { texto: "¿Para cuándo lo necesitás?", opciones: [] },
];

/** Una pregunta mientras se edita. */
export type PreguntaEnEdicion = {
  clave: string;
  texto: string;
  /** De la primera versión; la pantalla ya no lo pide y lo nuevo es "solicita". */
  sobre: SobrePregunta;
  opciones: string[];
  /** Lo tipeado en "Nueva opción" sin apretar Enter: al guardar también cuenta. */
  nuevaOpcion: string;
  /** Lo que tenía guardado: una pregunta vieja que dejaba escribir otra respuesta lo sigue haciendo. */
  textoLibreGuardado: boolean;
  obligatoria: boolean;
  /** Ya se intentó guardar: recién ahí se muestra lo que falta. */
  revisar: boolean;
  /** Recién agregada: el foco va a su pregunta. */
  nueva: boolean;
  /** Se contesta con un número (LAU-26): su respuesta es un dato de la receta. */
  esNumero: boolean;
  /** El nombre del dato ("ancho"). Sale del texto hasta que el dueño lo cambia. */
  variable: string;
  variablePropia: boolean;
  unidad: string;
  /** Tal como se escriben: "" = sin límite. */
  min: string;
  max: string;
};

const SIN_NUMERO = { esNumero: false, variable: "", variablePropia: false, unidad: "", min: "", max: "" } as const;

/** "1,5" o "1.5" → 1.5; "" → null; lo que no es un número, NaN (y la validación lo marca). */
function leerLimite(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  return limpio ? Number(limpio) : null;
}

function nuevaPregunta(texto = "", opciones: string[] = []): PreguntaEnEdicion {
  return {
    clave: crypto.randomUUID(),
    texto,
    sobre: "solicita",
    opciones,
    nuevaOpcion: "",
    textoLibreGuardado: false,
    obligatoria: true,
    revisar: false,
    nueva: true,
    ...SIN_NUMERO,
  };
}

function desdeGuardada(pregunta: PreguntaSolicitud): PreguntaEnEdicion {
  return {
    clave: crypto.randomUUID(),
    texto: pregunta.texto,
    sobre: pregunta.sobre,
    opciones: pregunta.opciones,
    nuevaOpcion: "",
    textoLibreGuardado: pregunta.textoLibre,
    obligatoria: pregunta.obligatoria,
    revisar: false,
    nueva: false,
    ...(pregunta.numero
      ? {
          esNumero: true,
          variable: pregunta.numero.variable,
          variablePropia: true,
          unidad: pregunta.numero.unidad,
          min: pregunta.numero.min === null ? "" : String(pregunta.numero.min).replace(".", ","),
          max: pregunta.numero.max === null ? "" : String(pregunta.numero.max).replace(".", ","),
        }
      : SIN_NUMERO),
  };
}

/** Las opciones que se mandarían, con lo tipeado y sin agregar. */
export function opcionesDe(pregunta: PreguntaEnEdicion): string[] {
  const pendiente = enUnaLinea(pregunta.nuevaOpcion);
  return [...pregunta.opciones, ...(pendiente ? [pendiente] : [])].map(enUnaLinea);
}

/**
 * Lo que se mandaría de esta pregunta. Sin opciones, el cliente responde con
 * sus palabras; con una sola no hay nada que elegir, así que también puede
 * escribir; con dos o más elige entre ellas.
 */
function aGuardar(pregunta: PreguntaEnEdicion): PreguntaSolicitud {
  if (pregunta.esNumero) {
    return {
      texto: enUnaLinea(pregunta.texto),
      sobre: pregunta.sobre,
      opciones: [],
      textoLibre: true,
      obligatoria: pregunta.obligatoria,
      numero: {
        variable: pregunta.variable.trim().toLowerCase(),
        unidad: enUnaLinea(pregunta.unidad),
        min: leerLimite(pregunta.min),
        max: leerLimite(pregunta.max),
      },
    };
  }
  const opciones = opcionesDe(pregunta);
  return {
    texto: enUnaLinea(pregunta.texto),
    sobre: pregunta.sobre,
    opciones,
    textoLibre: pregunta.textoLibreGuardado || opciones.length < 2,
    obligatoria: pregunta.obligatoria,
  };
}

/** El dato que le toca a una pregunta de número según su texto, sin chocar con los de las otras. */
function variableSugerida(pregunta: PreguntaEnEdicion, todas: PreguntaEnEdicion[]): string {
  const usadas = new Set(todas.filter((p) => p.clave !== pregunta.clave && p.esNumero).map((p) => p.variable));
  return variableDesdeTexto(pregunta.texto, usadas);
}

/** Estado de las preguntas de un producto a medida. Son opcionales: uno nuevo arranca sin ninguna. */
export function useSolicitudEnEdicion(inicial: SolicitudADemanda | null) {
  const [preguntas, setPreguntas] = useState<PreguntaEnEdicion[]>(() => inicial?.preguntas.map(desdeGuardada) ?? []);

  // Mientras el dueño no lo cambió, el dato de una pregunta de número sigue a su texto.
  const cambiar = (clave: string, cambios: Partial<PreguntaEnEdicion>) =>
    setPreguntas((actuales) =>
      actuales.map((p) => {
        if (p.clave !== clave) return p;
        const cambiada = { ...p, ...cambios };
        return cambiada.esNumero && !cambiada.variablePropia
          ? { ...cambiada, variable: variableSugerida(cambiada, actuales) }
          : cambiada;
      }),
    );

  const llena = preguntas.length >= MAX_PREGUNTAS;

  return {
    preguntas,
    llena,
    /** Para saber si hay cambios sin guardar: sin lo que es sólo de pantalla. */
    firma: JSON.stringify(preguntas.map(aGuardar)),
    /** Las preguntas sin escribir todavía, para el "Falta" del pie. */
    sinEscribir: preguntas.filter((p) => enUnaLinea(p.texto).length === 0).length,
    agregar: (texto?: string, opciones?: string[]) => {
      if (llena) return;
      setPreguntas((actuales) => [...actuales.map((p) => ({ ...p, nueva: false })), nuevaPregunta(texto, opciones)]);
    },
    cambiar,
    quitar: (clave: string) => setPreguntas((actuales) => actuales.filter((p) => p.clave !== clave)),
    agregarOpcion: (clave: string) =>
      setPreguntas((actuales) =>
        actuales.map((p) => {
          const opcion = enUnaLinea(p.nuevaOpcion);
          if (p.clave !== clave || !opcion || p.opciones.length >= MAX_OPCIONES) return p;
          // Una repetida no se agrega dos veces: alcanza con vaciar el campo.
          const repetida = p.opciones.some((o) => claveDeTexto(o) === claveDeTexto(opcion));
          return { ...p, opciones: repetida ? p.opciones : [...p.opciones, opcion], nuevaOpcion: "" };
        }),
      ),
    quitarOpcion: (clave: string, indice: number) =>
      setPreguntas((actuales) =>
        actuales.map((p) => (p.clave === clave ? { ...p, opciones: p.opciones.filter((_, i) => i !== indice) } : p)),
      ),
    /** Lo que se mandaría ahora, sin marcar errores: para la receta y su vista previa. */
    actuales: () => preguntas.map(aGuardar),
    /** Lo que se manda, o el texto del error (y las preguntas con problemas lo muestran). */
    armar: (): SolicitudADemanda | string => {
      const armadas = preguntas.map(aGuardar);
      const problema = problemaDeSolicitud(armadas);
      if (problema) {
        setPreguntas((actuales) => actuales.map((p) => (problemaDePregunta(aGuardar(p)) ? { ...p, revisar: true } : p)));
        return problema;
      }
      return { preguntas: armadas };
    },
  };
}

export type SolicitudEnEdicion = ReturnType<typeof useSolicitudEnEdicion>;

const ICONO_TACHO = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </svg>
);

function TarjetaPregunta({
  estado,
  pregunta,
  numero,
}: Readonly<{ estado: SolicitudEnEdicion; pregunta: PreguntaEnEdicion; numero: number }>) {
  const id = useId();
  const campo = useRef<HTMLInputElement>(null);
  const problema = pregunta.revisar ? problemaDePregunta(aGuardar(pregunta)) : null;

  useEffect(() => {
    if (pregunta.nueva) campo.current?.focus();
  }, [pregunta.nueva]);

  return (
    <li>
      <div
        role="group"
        aria-label={`Pregunta ${numero}`}
        className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4", problema ? "border-danger" : "border-line")}
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-7 grid size-6 flex-none place-items-center rounded-full bg-sunken text-[12px] font-bold text-ink-secondary"
          >
            {numero}
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-texto`} className={LABEL}>
              Tu asistente pregunta
            </label>
            <input
              id={`${id}-texto`}
              ref={campo}
              value={pregunta.texto}
              maxLength={LARGO_MAX_PREGUNTA}
              placeholder="Ej.: ¿Qué medidas tiene el espacio?"
              aria-invalid={problema ? true : undefined}
              aria-describedby={problema ? `${id}-problema` : undefined}
              onChange={(e) => estado.cambiar(pregunta.clave, { texto: e.target.value })}
              className={INPUT}
            />
          </div>
          <button
            type="button"
            aria-label={`Quitar pregunta ${numero}`}
            title="Quitar pregunta"
            onClick={() => estado.quitar(pregunta.clave)}
            className="mt-7 grid size-9 flex-none cursor-pointer place-items-center rounded-md text-muted hover:bg-sunken hover:text-danger-text"
          >
            {ICONO_TACHO}
          </button>
        </div>

        <div className="sm:pl-9">
          <label className="mb-3 flex min-h-[36px] items-center gap-2 text-[13.5px] text-ink">
            <input
              type="checkbox"
              checked={pregunta.esNumero}
              onChange={(e) => estado.cambiar(pregunta.clave, { esNumero: e.target.checked })}
              className="size-4 accent-[var(--color-semantic-primary-default)]"
            />
            Se contesta con un número
            <span className="text-[12.5px] text-muted">· para usarlo en la cuenta de la cotización</span>
          </label>

          {pregunta.esNumero ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label>
                <span className={LABEL}>Nombre del dato</span>
                <input
                  value={pregunta.variable}
                  maxLength={30}
                  placeholder="ancho"
                  onChange={(e) =>
                    estado.cambiar(pregunta.clave, {
                      variable: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                      variablePropia: true,
                    })
                  }
                  className={cn(INPUT, "font-mono")}
                />
              </label>
              <label>
                <span className={LABEL}>En qué unidad</span>
                <input
                  value={pregunta.unidad}
                  maxLength={LARGO_MAX_UNIDAD_PREGUNTA}
                  placeholder="cm"
                  onChange={(e) => estado.cambiar(pregunta.clave, { unidad: e.target.value })}
                  className={INPUT}
                />
              </label>
              <label>
                <span className={LABEL}>
                  Mínimo <span className="font-normal text-muted">(opcional)</span>
                </span>
                <input
                  inputMode="decimal"
                  value={pregunta.min}
                  onChange={(e) => estado.cambiar(pregunta.clave, { min: e.target.value })}
                  className={INPUT}
                />
              </label>
              <label>
                <span className={LABEL}>
                  Máximo <span className="font-normal text-muted">(opcional)</span>
                </span>
                <input
                  inputMode="decimal"
                  value={pregunta.max}
                  onChange={(e) => estado.cambiar(pregunta.clave, { max: e.target.value })}
                  className={INPUT}
                />
              </label>
            </div>
          ) : (
            <>
              <p className={LABEL}>
                Y le da estas opciones{" "}
                <span className="font-normal text-muted">· si no ponés ninguna, responde con sus palabras</span>
              </p>
              <ListaDePastillas
                items={pregunta.opciones}
                nombreLista="Opciones"
                nombreNuevo="Nueva opción"
                placeholder="+ Opción (Enter)"
                nuevo={pregunta.nuevaOpcion}
                largoMaximo={LARGO_MAX_OPCION}
                llena={pregunta.opciones.length >= MAX_OPCIONES}
                onNuevo={(texto) => estado.cambiar(pregunta.clave, { nuevaOpcion: texto })}
                onAgregar={() => estado.agregarOpcion(pregunta.clave)}
                onQuitar={(indice) => estado.quitarOpcion(pregunta.clave, indice)}
              />
            </>
          )}

          <label className="mt-3 flex min-h-[36px] items-center gap-2 text-[13.5px] text-ink">
            <input
              type="checkbox"
              checked={pregunta.obligatoria}
              onChange={(e) => estado.cambiar(pregunta.clave, { obligatoria: e.target.checked })}
              className="size-4 accent-[var(--color-semantic-primary-default)]"
            />
            La necesito sí o sí para cotizar
          </label>

          {problema && (
            <p id={`${id}-problema`} role="alert" className="mt-1 text-[12.5px] text-danger-text">
              {problema}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * "Preguntas para hacer" de un producto a medida: lo que el asistente le
 * pregunta al cliente para que el comercio pueda cotizar, y las opciones que
 * le da. Opcional: sin preguntas, el asistente pregunta lo básico.
 */
export function SeccionSolicitud({ estado, numero }: Readonly<{ estado: SolicitudEnEdicion; numero?: number }>) {
  const textos = new Set(estado.preguntas.map((p) => claveDeTexto(p.texto)));
  const ideas = IDEAS_DE_PREGUNTAS.filter((idea) => !textos.has(claveDeTexto(idea.texto)));

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Preguntas para hacer</legend>
      <EncabezadoDeSeccion
        numero={numero}
        titulo="Preguntas para hacer"
        opcional
        ayuda="Lo que tu asistente le pregunta al cliente, y las opciones que le da."
        extra={
          <span className="text-[12.5px] text-muted">
            {estado.preguntas.length} de {MAX_PREGUNTAS}
          </span>
        }
      />

      {estado.preguntas.length === 0 ? (
        <p className="rounded-md bg-sunken px-4 py-3 text-[13.5px] text-ink-secondary">
          Sin preguntas propias, tu asistente pregunta lo básico: qué necesita y para cuándo.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {estado.preguntas.map((pregunta, indice) => (
            <TarjetaPregunta key={pregunta.clave} estado={estado} pregunta={pregunta} numero={indice + 1} />
          ))}
        </ol>
      )}

      {estado.llena ? (
        <p className="text-[12.5px] text-muted">Llegaste al máximo de {MAX_PREGUNTAS} preguntas.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => estado.agregar()}
            className="cursor-pointer rounded-md border border-dashed border-line-strong bg-card px-3.5 py-2 text-[14px] font-semibold text-primary hover:bg-primary-subtle"
          >
            + Agregar pregunta
          </button>
          {ideas.length > 0 && <span className="text-[12.5px] text-muted">Ideas:</span>}
          {ideas.map((idea) => (
            <button
              key={idea.texto}
              type="button"
              onClick={() => estado.agregar(idea.texto, idea.opciones)}
              className="cursor-pointer rounded-full border border-line bg-card px-3 py-1 text-[13px] text-ink hover:border-line-strong"
            >
              {idea.texto}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/** El título numerado de cada sección del editor a medida. */
export function EncabezadoDeSeccion({
  numero,
  titulo,
  opcional = false,
  ayuda,
  extra,
}: Readonly<{ numero?: number; titulo: string; opcional?: boolean; ayuda?: string; extra?: ReactNode }>) {
  return (
    <div className="flex items-start gap-3">
      {numero !== undefined && (
        <span
          aria-hidden
          className="grid size-7 flex-none place-items-center rounded-full bg-primary text-[13px] font-bold text-primary-on"
        >
          {numero}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="flex flex-wrap items-center gap-2 font-display text-[16.5px] font-bold text-ink">
          {titulo}
          {opcional && (
            <span className="rounded-full bg-sunken px-2 py-0.5 font-body text-[11.5px] font-semibold text-muted">
              opcional
            </span>
          )}
        </h3>
        {ayuda && <p className="mt-0.5 text-[13px] text-ink-secondary">{ayuda}</p>}
      </div>
      {extra}
    </div>
  );
}
