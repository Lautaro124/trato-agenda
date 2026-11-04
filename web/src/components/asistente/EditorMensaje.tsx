"use client";

import { Icono, TextoConDatos } from "@/components/ui/TextoConDatos";
import { cn } from "@/lib/cn";
import {
  MAX_CARACTERES_MENSAJE,
  type DefinicionMensaje,
  type MensajeConfigurado,
  type Validacion,
} from "@/lib/mensajes";

const SEGMENTO = "min-h-11 rounded-[9px] text-[14px] font-bold transition-colors";
const SEGMENTO_ACTIVO = "bg-card text-ink shadow-sm";
const SEGMENTO_INACTIVO = "text-ink-secondary hover:text-ink";

/**
 * Un mensaje: "lo escribe el asistente" o "mi mensaje". El texto propio va en
 * una caja con una barra de datos arriba; cada botón inserta `{dato}` donde
 * está el cursor, y en la vista previa ese dato aparece completado.
 */
export function EditorMensaje({
  definicion,
  mensaje,
  validacion,
  nombreBot,
  onCambio,
}: {
  definicion: DefinicionMensaje;
  mensaje: MensajeConfigurado;
  validacion: Validacion;
  nombreBot: string;
  onCambio: (mensaje: MensajeConfigurado) => void;
}) {
  const propio = mensaje.modo === "propio";
  const idAyuda = `ayuda-${definicion.clave}`;
  const idError = `error-${definicion.clave}`;

  return (
    <section
      aria-labelledby={`titulo-${definicion.clave}`}
      className="flex min-w-0 flex-col gap-5 rounded-lg border border-line bg-card p-5 shadow-sm md:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={`titulo-${definicion.clave}`} className="font-display text-[22px] font-bold text-ink">
          {definicion.nombre}
        </h2>
        <p className="text-sm leading-[1.6] text-ink-secondary">{definicion.cuando}</p>
      </div>

      {!definicion.soloPropio && (
        <div role="group" aria-label="Quién escribe este mensaje" className="grid grid-cols-2 gap-1 rounded-md bg-sunken p-1">
          <button
            type="button"
            aria-pressed={!propio}
            onClick={() => onCambio({ ...mensaje, modo: "auto" })}
            className={cn(SEGMENTO, propio ? SEGMENTO_INACTIVO : SEGMENTO_ACTIVO)}
          >
            {definicion.fijo ? "Mensaje estándar" : `Lo escribe ${nombreBot}`}
          </button>
          <button
            type="button"
            aria-pressed={propio}
            onClick={() => onCambio({ modo: "propio", texto: mensaje.texto.trim() ? mensaje.texto : definicion.sugerido })}
            className={cn(SEGMENTO, propio ? SEGMENTO_ACTIVO : SEGMENTO_INACTIVO)}
          >
            Mi mensaje
          </button>
        </div>
      )}

      {!propio ? (
        <p className="rounded-md border border-dashed border-line-strong bg-page p-4 text-sm leading-[1.6] text-ink-secondary">
          {definicion.fijo
            ? "Se manda el mensaje estándar de Trato, el que ves en la vista previa. Pasá a «Mi mensaje» para escribir el tuyo."
            : `${nombreBot} lo redacta en cada charla, con tu tono y los datos del momento. Si preferís que diga siempre lo mismo, pasá a «Mi mensaje».`}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`texto-${definicion.clave}`} className="text-sm font-bold text-ink">
                Texto del mensaje
              </label>
              <span
                className={cn(
                  "text-[13px]",
                  mensaje.texto.trim().length > MAX_CARACTERES_MENSAJE ? "text-danger-text" : "text-ink-secondary",
                )}
              >
                {mensaje.texto.trim().length} / {MAX_CARACTERES_MENSAJE}
              </span>
            </div>

            <TextoConDatos
              id={`texto-${definicion.clave}`}
              valor={mensaje.texto}
              onCambio={(texto) => onCambio({ ...mensaje, texto })}
              variables={definicion.variables}
              obligatorias={definicion.obligatorias}
              invalido={validacion.error !== null}
              describedBy={validacion.error ? `${idAyuda} ${idError}` : idAyuda}
            />

            <p id={idAyuda} className="text-[13px] leading-[1.5] text-ink-secondary">
              Tocá un dato y se inserta donde está el cursor. En el texto se ve entre llaves, como{" "}
              <span className="font-mono text-primary-active">{"{nombre}"}</span>; al cliente le llega el dato real.
            </p>

            {validacion.error && (
              <p id={idError} role="alert" className="flex items-start gap-2 text-[13px] font-semibold text-danger-text">
                <Icono d={["M12 8v5", "M12 16h.01"]} className="mt-0.5 flex-none" />
                {validacion.error}
              </p>
            )}
            {!validacion.error && validacion.aviso && (
              <p className="rounded-md bg-warning-subtle px-3 py-2 text-[13px] font-semibold text-warning-text">
                {validacion.aviso}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-[13px] text-ink-secondary">
              {definicion.fijo ? "Se manda tal cual, con los datos completados." : `${nombreBot} lo manda tal cual, con los datos completados.`}
            </p>
            <button
              type="button"
              onClick={() => onCambio({ ...mensaje, texto: definicion.sugerido })}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-bold text-primary-hover hover:bg-primary-subtle"
            >
              <Icono d={["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"]} />
              Usar el texto sugerido
            </button>
          </div>
        </>
      )}
    </section>
  );
}
