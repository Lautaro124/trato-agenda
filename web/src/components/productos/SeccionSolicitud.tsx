"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import {
  LARGO_MAX_OPCION,
  LARGO_MAX_PREGUNTA,
  MAX_OPCIONES,
  MAX_PREGUNTAS,
  claveDeTexto,
  enUnaLinea,
  problemaDePregunta,
  problemaDeSolicitud,
  resumenDeRespuesta,
  type PreguntaSolicitud,
  type SobrePregunta,
  type SolicitudADemanda,
} from "@/lib/solicitud";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2.5 text-[14.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";
const LABEL = "mb-1.5 block text-[12.5px] font-semibold text-ink-secondary";

/** Una pregunta mientras se edita: las opciones se conservan aunque se pase a "Lo escribe". */
type PreguntaEnEdicion = {
  clave: string;
  texto: string;
  sobre: SobrePregunta;
  conOpciones: boolean;
  opciones: string[];
  /** Lo tipeado en "Nueva opción" sin apretar Agregar: al guardar también cuenta. */
  nuevaOpcion: string;
  textoLibre: boolean;
  obligatoria: boolean;
  abierta: boolean;
  /** Ya se intentó cerrarla o guardar: recién ahí se muestra lo que falta. */
  revisar: boolean;
  /** Recién agregada: el foco va a su pregunta. */
  nueva: boolean;
};

const BLOQUES: ReadonlyArray<{
  sobre: SobrePregunta;
  numero: number;
  titulo: string;
  ayuda: string;
  ejemplo: string;
}> = [
  {
    sobre: "tiene",
    numero: 1,
    titulo: "Lo que el cliente ya tiene",
    ayuda: "Para entender su situación: medidas, modelo, estado…",
    ejemplo: "Ej.: ¿Qué medidas tiene el espacio?",
  },
  {
    sobre: "solicita",
    numero: 2,
    titulo: "Lo que te pide",
    ayuda: "Cómo lo quiere: color, material, terminación…",
    ejemplo: "Ej.: ¿De qué color lo querés?",
  },
];

const NOMBRE_BLOQUE: Record<SobrePregunta, string> = { tiene: "Lo que el cliente ya tiene", solicita: "Lo que te pide" };
const OTRO: Record<SobrePregunta, SobrePregunta> = { tiene: "solicita", solicita: "tiene" };

function nuevaPregunta(sobre: SobrePregunta): PreguntaEnEdicion {
  return {
    clave: crypto.randomUUID(),
    texto: "",
    sobre,
    conOpciones: true,
    opciones: [],
    nuevaOpcion: "",
    textoLibre: false,
    obligatoria: true,
    abierta: true,
    revisar: false,
    nueva: true,
  };
}

function desdeGuardada(pregunta: PreguntaSolicitud): PreguntaEnEdicion {
  return {
    clave: crypto.randomUUID(),
    texto: pregunta.texto,
    sobre: pregunta.sobre,
    conOpciones: pregunta.opciones.length > 0,
    opciones: pregunta.opciones,
    nuevaOpcion: "",
    textoLibre: pregunta.textoLibre,
    obligatoria: pregunta.obligatoria,
    abierta: false,
    revisar: false,
    nueva: false,
  };
}

/** Lo que se mandaría de esta pregunta: "Lo escribe" es sin opciones y con texto libre. */
function aGuardar(pregunta: PreguntaEnEdicion): PreguntaSolicitud {
  const pendiente = enUnaLinea(pregunta.nuevaOpcion);
  const opciones = pregunta.conOpciones
    ? [...pregunta.opciones, ...(pendiente ? [pendiente] : [])].map(enUnaLinea)
    : [];
  return {
    texto: enUnaLinea(pregunta.texto),
    sobre: pregunta.sobre,
    opciones,
    textoLibre: pregunta.conOpciones ? pregunta.textoLibre : true,
    obligatoria: pregunta.obligatoria,
  };
}

/**
 * Estado de las preguntas de un producto a medida. Uno nuevo arranca con una
 * pregunta vacía, lista para escribir.
 */
export function useSolicitudEnEdicion(inicial: SolicitudADemanda | null) {
  const [preguntas, setPreguntas] = useState<PreguntaEnEdicion[]>(
    () => inicial?.preguntas.map(desdeGuardada) ?? [{ ...nuevaPregunta("tiene"), nueva: false }],
  );

  const cambiar = (clave: string, cambios: Partial<PreguntaEnEdicion>) =>
    setPreguntas((actuales) => actuales.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)));

  const llena = preguntas.length >= MAX_PREGUNTAS;

  return {
    preguntas,
    llena,
    /** Para saber si hay cambios sin guardar: sin lo que es sólo de pantalla. */
    firma: JSON.stringify(preguntas.map(aGuardar)),
    agregar: (sobre: SobrePregunta) => {
      if (llena) return;
      setPreguntas((actuales) => [...actuales.map((p) => ({ ...p, nueva: false })), nuevaPregunta(sobre)]);
    },
    cambiar,
    quitar: (clave: string) => setPreguntas((actuales) => actuales.filter((p) => p.clave !== clave)),
    /** Al final de su nuevo bloque, para que se vea dónde quedó. */
    mover: (clave: string) =>
      setPreguntas((actuales) => {
        const pregunta = actuales.find((p) => p.clave === clave);
        if (!pregunta) return actuales;
        return [...actuales.filter((p) => p.clave !== clave), { ...pregunta, sobre: OTRO[pregunta.sobre], nueva: false }];
      }),
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
    /** "Listo": se pliega sólo si está completa; si no, queda abierta y dice qué falta. */
    cerrar: (clave: string) =>
      setPreguntas((actuales) =>
        actuales.map((p) =>
          p.clave !== clave ? p : problemaDePregunta(aGuardar(p)) ? { ...p, revisar: true } : { ...p, abierta: false },
        ),
      ),
    /** Lo que se manda, o el texto del error (y las preguntas con problemas quedan abiertas mostrándolo). */
    armar: (): SolicitudADemanda | string => {
      const armadas = preguntas.map(aGuardar);
      const problema = problemaDeSolicitud(armadas);
      if (problema) {
        setPreguntas((actuales) =>
          actuales.map((p) => (problemaDePregunta(aGuardar(p)) ? { ...p, abierta: true, revisar: true } : p)),
        );
        return problema;
      }
      return {
        preguntas: [...armadas.filter((p) => p.sobre === "tiene"), ...armadas.filter((p) => p.sobre === "solicita")],
      };
    },
  };
}

export type SolicitudEnEdicion = ReturnType<typeof useSolicitudEnEdicion>;

const ICONO_CHEVRON = (abierta: boolean) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={cn("flex-none text-primary-hover transition-transform", abierta && "rotate-180")}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const ICONO_QUITAR = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/** Las opciones como pastillas chicas, para la pregunta plegada. */
function OpcionesResumidas({ opciones }: { opciones: string[] }) {
  const visibles = opciones.slice(0, 4);
  return (
    <>
      {visibles.map((opcion) => (
        <span key={opcion} className="rounded-full border border-line bg-sunken px-2 py-px text-[12px] text-ink">
          {opcion}
        </span>
      ))}
      {opciones.length > visibles.length && (
        <span className="text-[12px] text-muted">+{opciones.length - visibles.length}</span>
      )}
    </>
  );
}

function TarjetaPregunta({ estado, pregunta }: { estado: SolicitudEnEdicion; pregunta: PreguntaEnEdicion }) {
  const id = useId();
  const campoPregunta = useRef<HTMLInputElement>(null);
  const armada = aGuardar(pregunta);
  const problema = problemaDePregunta(armada);
  const mostrarProblema = pregunta.revisar && problema;
  const opcionesLlenas = pregunta.opciones.length >= MAX_OPCIONES;
  const nombre = armada.texto || "sin escribir";

  // Nueva: directo a escribir la pregunta. Sólo al aparecer, no en cada render.
  const enfocar = pregunta.nueva;
  useEffect(() => {
    if (enfocar) campoPregunta.current?.focus();
  }, [enfocar]);

  if (!pregunta.abierta) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-label={`Editar pregunta: ${nombre}`}
        onClick={() => estado.cambiar(pregunta.clave, { abierta: true })}
        className="flex w-full cursor-pointer items-start gap-3 rounded-md border border-line bg-card px-3.5 py-3 text-left hover:border-line-strong"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold break-words text-ink">{armada.texto}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-secondary">
            <span
              className={cn(
                "rounded-full px-2 py-px text-[11.5px] font-semibold",
                armada.obligatoria ? "bg-primary-subtle text-primary-hover" : "bg-sunken text-ink-secondary",
              )}
            >
              {armada.obligatoria ? "Obligatoria" : "Opcional"}
            </span>
            <OpcionesResumidas opciones={armada.opciones} />
            {resumenDeRespuesta(armada) && <span>{resumenDeRespuesta(armada)}</span>}
          </span>
        </span>
        <span className="mt-0.5 flex flex-none items-center gap-1 text-[13px] font-semibold text-primary-hover">
          Editar {ICONO_CHEVRON(false)}
        </span>
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`Pregunta: ${nombre}`}
      className={cn(
        "flex flex-col gap-3.5 rounded-md border bg-card p-3.5",
        mostrarProblema ? "border-danger" : "border-line-strong",
      )}
    >
      <div>
        <label htmlFor={`${id}-texto`} className={LABEL}>
          Pregunta
        </label>
        <input
          id={`${id}-texto`}
          ref={campoPregunta}
          value={pregunta.texto}
          maxLength={LARGO_MAX_PREGUNTA}
          placeholder={BLOQUES.find((b) => b.sobre === pregunta.sobre)?.ejemplo}
          onChange={(e) => estado.cambiar(pregunta.clave, { texto: e.target.value })}
          aria-invalid={mostrarProblema ? true : undefined}
          aria-describedby={mostrarProblema ? `${id}-problema` : undefined}
          className={INPUT}
        />
      </div>

      <div>
        <span id={`${id}-modo`} className={LABEL}>
          ¿Cómo responde el cliente?
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-modo`} className="grid grid-cols-2 gap-0.5 rounded-md bg-sunken p-[3px]">
          {(
            [
              [true, "Elige una opción"],
              [false, "Lo escribe"],
            ] as const
          ).map(([conOpciones, texto]) => {
            const marcada = pregunta.conOpciones === conOpciones;
            return (
              <button
                key={texto}
                type="button"
                role="radio"
                aria-checked={marcada}
                onClick={() => estado.cambiar(pregunta.clave, { conOpciones })}
                className={cn(
                  "min-h-9 cursor-pointer rounded-sm px-3 text-[13.5px]",
                  marcada ? "bg-card font-bold text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
                )}
              >
                {texto}
              </button>
            );
          })}
        </div>
      </div>

      {pregunta.conOpciones ? (
        <div className="flex flex-col gap-2.5">
          {pregunta.opciones.length > 0 && (
            <ul aria-label="Opciones" className="flex flex-wrap gap-1.5">
              {pregunta.opciones.map((opcion, indice) => (
                <li
                  key={`${opcion}-${indice}`}
                  className="flex items-center gap-1 rounded-full border border-primary bg-primary-subtle py-1 pr-1 pl-3 text-[13px] font-semibold text-ink"
                >
                  {opcion}
                  <button
                    type="button"
                    aria-label={`Quitar opción ${opcion}`}
                    onClick={() => estado.quitarOpcion(pregunta.clave, indice)}
                    className="grid size-6 cursor-pointer place-items-center rounded-full text-ink-secondary hover:bg-card hover:text-ink"
                  >
                    {ICONO_QUITAR}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <input
              value={pregunta.nuevaOpcion}
              maxLength={LARGO_MAX_OPCION}
              disabled={opcionesLlenas}
              aria-label="Nueva opción"
              placeholder={pregunta.opciones.length === 0 ? "Escribí una opción (ej.: Chica)" : "Otra opción"}
              onChange={(e) => estado.cambiar(pregunta.clave, { nuevaOpcion: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  estado.agregarOpcion(pregunta.clave);
                }
              }}
              className={cn(INPUT, "min-w-0 flex-1 disabled:bg-sunken")}
            />
            <Button
              variant="secondary"
              size="md"
              disabled={opcionesLlenas || !pregunta.nuevaOpcion.trim()}
              onClick={() => estado.agregarOpcion(pregunta.clave)}
            >
              Agregar
            </Button>
          </div>
          {opcionesLlenas && <p className="text-[12.5px] text-muted">Llegaste al máximo de {MAX_OPCIONES} opciones.</p>}
          <label className="flex items-start gap-2 text-[13.5px] text-ink">
            <input
              type="checkbox"
              checked={pregunta.textoLibre}
              onChange={(e) => estado.cambiar(pregunta.clave, { textoLibre: e.target.checked })}
              className="mt-0.5 size-4 flex-none accent-[var(--color-semantic-primary-default)]"
            />
            <span>Si ninguna le sirve, puede escribir otra respuesta</span>
          </label>
        </div>
      ) : (
        <p className="rounded-md bg-sunken px-3 py-2 text-[13px] text-ink-secondary">
          El cliente responde con sus palabras. Sirve para medidas, modelos o detalles que no entran en una lista.
        </p>
      )}

      <label className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2.5">
        <span>
          <span className="block text-[14px] font-semibold text-ink">Obligatoria</span>
          <span className="block text-[12.5px] text-ink-secondary">Sin esta respuesta no se puede presupuestar</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={pregunta.obligatoria}
          onChange={(e) => estado.cambiar(pregunta.clave, { obligatoria: e.target.checked })}
          aria-label="Obligatoria"
          className="size-5 flex-none accent-[var(--color-semantic-primary-default)]"
        />
      </label>

      {mostrarProblema && (
        <p id={`${id}-problema`} role="alert" className="text-[13px] font-semibold text-danger-text">
          {problema}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => estado.mover(pregunta.clave)}
          className="min-h-9 cursor-pointer text-[13px] font-semibold text-primary-hover hover:underline"
        >
          Pasar a «{NOMBRE_BLOQUE[OTRO[pregunta.sobre]]}»
        </button>
        <button
          type="button"
          onClick={() => estado.quitar(pregunta.clave)}
          className="min-h-9 cursor-pointer text-[13px] text-danger-text hover:underline"
        >
          Quitar pregunta
        </button>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => estado.cerrar(pregunta.clave)}>
          Listo
        </Button>
      </div>
    </div>
  );
}

/**
 * Las preguntas que el asistente le hace al cliente para presupuestar un
 * producto a medida, en dos bloques (lo que ya tiene y lo que pide) así el
 * dueño no tiene que entender una etiqueta abstracta: el bloque lo dice.
 */
export function SeccionSolicitud({ estado }: { estado: SolicitudEnEdicion }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-[var(--color-primitive-coral-200)] bg-primary-subtle p-4">
      <legend className="px-1 text-[13.5px] font-bold text-ink">Preguntas para presupuestar</legend>
      <p className="text-[12.5px] leading-[1.5] text-ink-secondary">
        Tu asistente se las hace al cliente antes de pasarte el pedido, así tenés lo que necesitás para cotizarlo.
      </p>

      <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
        {BLOQUES.map((bloque) => {
          const delBloque = estado.preguntas.filter((p) => p.sobre === bloque.sobre);
          return (
            <section key={bloque.sobre} aria-label={bloque.titulo} className="flex flex-col gap-2.5">
              <div className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className="grid size-6 flex-none place-items-center rounded-full bg-primary text-[12.5px] font-bold text-primary-on"
                >
                  {bloque.numero}
                </span>
                <div>
                  <h3 className="text-[14.5px] font-bold text-ink">{bloque.titulo}</h3>
                  <p className="text-[12.5px] text-ink-secondary">{bloque.ayuda}</p>
                </div>
              </div>

              {delBloque.length === 0 ? (
                <p className="rounded-md border border-dashed border-line-strong bg-card px-3.5 py-3 text-[13px] text-muted">
                  Sin preguntas todavía. {bloque.ejemplo}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {delBloque.map((pregunta) => (
                    <li key={pregunta.clave}>
                      <TarjetaPregunta estado={estado} pregunta={pregunta} />
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => estado.agregar(bloque.sobre)}
                disabled={estado.llena}
                aria-label={`Agregar pregunta a ${bloque.titulo}`}
                className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-primary bg-card text-[13.5px] font-semibold text-primary-hover hover:bg-primary-subtle disabled:cursor-not-allowed disabled:border-line disabled:text-muted"
              >
                + Agregar pregunta
              </button>
            </section>
          );
        })}
        {estado.llena && (
          <p className="text-[12.5px] text-muted lg:col-span-2">Llegaste al máximo de {MAX_PREGUNTAS} preguntas.</p>
        )}
      </div>
    </fieldset>
  );
}
