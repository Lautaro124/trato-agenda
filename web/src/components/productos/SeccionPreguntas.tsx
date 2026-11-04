"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/productos/EditorProducto";
import {
  LARGO_OPCION,
  LARGO_PREGUNTA,
  MAX_OPCIONES,
  MAX_PREGUNTAS,
  MIN_OPCIONES,
  type PreguntaProducto,
} from "@/lib/productos";

/** Una pregunta mientras se edita: con una clave estable para la lista y la opción que se está tipeando. */
export type PreguntaEnEdicion = PreguntaProducto & { clave: string; nuevaOpcion: string };

let contador = 0;
const claveNueva = () => `pregunta-${++contador}`;

export function preguntasDesdeProducto(preguntas: PreguntaProducto[] | null | undefined): PreguntaEnEdicion[] {
  return (preguntas ?? []).map((pregunta) => ({ ...pregunta, clave: claveNueva(), nuevaOpcion: "" }));
}

const sinEspacios = (texto: string) => texto.trim().replace(/\s+/g, " ");
const clave = (texto: string) => sinEspacios(texto).toLocaleLowerCase("es");

/** Valida en el navegador lo mismo que la API; devuelve lo que se guarda (null = sin preguntas) o el motivo. */
export function armarPreguntas(preguntas: PreguntaEnEdicion[]): PreguntaProducto[] | null | string {
  const textos = new Set<string>();
  const armadas: PreguntaProducto[] = [];
  for (const [indice, pregunta] of preguntas.entries()) {
    const lugar = `La pregunta ${indice + 1}`;
    const texto = sinEspacios(pregunta.texto);
    if (!texto) return `${lugar} está vacía: escribí qué le pregunta el asistente o borrala.`;
    if (textos.has(clave(texto))) return `${lugar} está repetida.`;
    textos.add(clave(texto));
    if (pregunta.tipo === "texto") {
      armadas.push({ texto, tipo: "texto", opciones: [], obligatoria: pregunta.obligatoria });
      continue;
    }
    // Lo que quedó tipeado sin tocar «Agregar» se cuenta igual: mejor que perderlo en silencio.
    const opciones = [...pregunta.opciones, pregunta.nuevaOpcion].map(sinEspacios).filter(Boolean);
    if (new Set(opciones.map(clave)).size !== opciones.length) return `${lugar} tiene una opción repetida.`;
    if (opciones.length < MIN_OPCIONES) return `${lugar} necesita al menos ${MIN_OPCIONES} opciones.`;
    if (opciones.length > MAX_OPCIONES) return `${lugar} puede tener hasta ${MAX_OPCIONES} opciones.`;
    armadas.push({ texto, tipo: "opciones", opciones, obligatoria: pregunta.obligatoria });
  }
  return armadas.length > 0 ? armadas : null;
}

const ICONO = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const BOTON_ICONO =
  "grid size-11 flex-none place-items-center rounded-md text-ink-secondary hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Las preguntas que el asistente le hace al cliente al pedir el producto:
 * de opciones (elige una) o de texto libre, obligatorias o no. No cambian el
 * precio. Las respuestas quedan en el pedido.
 */
export function SeccionPreguntas({
  preguntas,
  onCambio,
}: Readonly<{
  preguntas: PreguntaEnEdicion[];
  onCambio: (preguntas: PreguntaEnEdicion[]) => void;
}>) {
  const id = useId();
  const cambiar = (indice: number, cambios: Partial<PreguntaEnEdicion>) =>
    onCambio(preguntas.map((pregunta, i) => (i === indice ? { ...pregunta, ...cambios } : pregunta)));
  const mover = (indice: number, delta: -1 | 1) => {
    const copia = [...preguntas];
    [copia[indice], copia[indice + delta]] = [copia[indice + delta], copia[indice]];
    onCambio(copia);
  };
  const agregarOpcion = (indice: number) => {
    const pregunta = preguntas[indice];
    const opcion = sinEspacios(pregunta.nuevaOpcion);
    if (!opcion) return;
    const repetida = pregunta.opciones.some((existente) => clave(existente) === clave(opcion));
    cambiar(indice, {
      opciones: repetida || pregunta.opciones.length >= MAX_OPCIONES ? pregunta.opciones : [...pregunta.opciones, opcion],
      nuevaOpcion: "",
    });
  };

  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-4 rounded-lg border border-line p-4">
      <div>
        <h2 id={`${id}-titulo`} className="text-[13.5px] font-bold text-ink">
          Preguntas al pedir
        </h2>
        <p className="text-[12.5px] text-ink-secondary">
          El asistente se las hace al cliente antes de confirmar el pedido y guarda las respuestas junto al producto. No cambian el precio.
        </p>
      </div>

      {preguntas.map((pregunta, indice) => {
        const base = `${id}-${pregunta.clave}`;
        return (
          <div key={pregunta.clave} className="flex flex-col gap-3.5 rounded-md border border-line bg-page p-4">
            <div className="flex items-center gap-1">
              <span className="rounded-full bg-sunken px-2.5 py-1 text-[12px] font-bold text-ink-secondary">
                Pregunta {indice + 1}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                aria-label={`Subir la pregunta ${indice + 1}`}
                disabled={indice === 0}
                onClick={() => mover(indice, -1)}
                className={BOTON_ICONO}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...ICONO}>
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Bajar la pregunta ${indice + 1}`}
                disabled={indice === preguntas.length - 1}
                onClick={() => mover(indice, 1)}
                className={BOTON_ICONO}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...ICONO}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={`Eliminar la pregunta ${indice + 1}`}
                onClick={() => onCambio(preguntas.filter((_, i) => i !== indice))}
                className={`${BOTON_ICONO} text-danger-text`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...ICONO}>
                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </button>
            </div>

            <div>
              <label htmlFor={`${base}-texto`} className={LABEL}>
                Qué le pregunta el asistente
              </label>
              <input
                id={`${base}-texto`}
                value={pregunta.texto}
                maxLength={LARGO_PREGUNTA}
                placeholder="¿Qué talle querés?"
                onChange={(e) => cambiar(indice, { texto: e.target.value })}
                className={INPUT}
              />
            </div>

            <div role="radiogroup" aria-label={`Tipo de respuesta de la pregunta ${indice + 1}`} className="flex flex-wrap gap-2">
              {(
                [
                  ["opciones", "Elegir entre opciones"],
                  ["texto", "Texto libre"],
                ] as const
              ).map(([tipo, titulo]) => (
                <label
                  key={tipo}
                  className="flex min-h-11 cursor-pointer items-center rounded-md border-2 border-line bg-card px-3.5 text-[14px] font-semibold text-ink has-checked:border-primary has-checked:bg-primary-subtle has-checked:font-bold has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[var(--color-semantic-border-focus)]"
                >
                  <input
                    type="radio"
                    name={`${base}-tipo`}
                    value={tipo}
                    checked={pregunta.tipo === tipo}
                    onChange={() => cambiar(indice, { tipo })}
                    className="sr-only"
                  />
                  {titulo}
                </label>
              ))}
            </div>

            {pregunta.tipo === "opciones" && (
              <fieldset className="min-w-0">
                <legend className={LABEL}>Opciones</legend>
                {pregunta.opciones.length > 0 && (
                  <ul className="mb-2 flex flex-wrap gap-2">
                    {pregunta.opciones.map((opcion) => (
                      <li
                        key={opcion}
                        className="flex min-h-11 items-center gap-0.5 rounded-full border border-line-strong bg-card pr-1 pl-3.5 text-[14px] font-semibold text-ink"
                      >
                        {opcion}
                        <button
                          type="button"
                          aria-label={`Quitar la opción ${opcion}`}
                          onClick={() => cambiar(indice, { opciones: pregunta.opciones.filter((o) => o !== opcion) })}
                          className="grid size-9 place-items-center rounded-full text-ink-secondary hover:bg-sunken"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" {...ICONO} strokeWidth={2.4}>
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <label htmlFor={`${base}-opcion`} className="sr-only">
                    Nueva opción de la pregunta {indice + 1}
                  </label>
                  <input
                    id={`${base}-opcion`}
                    value={pregunta.nuevaOpcion}
                    maxLength={LARGO_OPCION}
                    placeholder="Escribí una opción y tocá Agregar"
                    onChange={(e) => cambiar(indice, { nuevaOpcion: e.target.value })}
                    onKeyDown={(e) => {
                      // Enter acá agrega la opción; no tiene que guardar el producto.
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      agregarOpcion(indice);
                    }}
                    className={INPUT}
                  />
                  <Button variant="secondary" onClick={() => agregarOpcion(indice)}>
                    Agregar
                  </Button>
                </div>
                {pregunta.opciones.length < MIN_OPCIONES && (
                  <p className="mt-1.5 text-[12.5px] text-muted">Cargá al menos {MIN_OPCIONES} opciones.</p>
                )}
              </fieldset>
            )}

            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
              <input
                type="checkbox"
                checked={pregunta.obligatoria}
                onChange={(e) => cambiar(indice, { obligatoria: e.target.checked })}
                className="size-[18px]"
              />
              Obligatoria: el asistente no confirma el pedido sin esta respuesta
            </label>
          </div>
        );
      })}

      {preguntas.length < MAX_PREGUNTAS ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() =>
            onCambio([
              ...preguntas,
              { clave: claveNueva(), texto: "", tipo: "opciones", opciones: [], obligatoria: true, nuevaOpcion: "" },
            ])
          }
        >
          Agregar pregunta
        </Button>
      ) : (
        <p className="text-[12.5px] text-muted">Llegaste al máximo de {MAX_PREGUNTAS} preguntas por producto.</p>
      )}
    </section>
  );
}
