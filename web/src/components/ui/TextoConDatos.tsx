"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { ETIQUETAS_VARIABLE, insertarVariable, variablesUsadas } from "@/lib/mensajes";

export function Icono({ d, className }: { d: string[]; className?: string }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {d.map((trazo) => (
        <path key={trazo} d={trazo} />
      ))}
    </svg>
  );
}

/**
 * Caja de texto con una barra de datos arriba: cada botón inserta `{dato}`
 * donde está el cursor. El dato ya usado se marca, y el obligatorio que falta
 * se resalta.
 */
export function TextoConDatos({
  id,
  valor,
  onCambio,
  variables,
  obligatorias = [],
  filas = 5,
  maxLength,
  placeholder,
  invalido = false,
  describedBy,
}: {
  id: string;
  valor: string;
  onCambio: (texto: string) => void;
  variables: readonly string[];
  obligatorias?: readonly string[];
  filas?: number;
  maxLength?: number;
  placeholder?: string;
  invalido?: boolean;
  describedBy?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Dónde estaba el cursor la última vez que el dueño tocó el texto, y dónde
  // dejarlo después de insertar un dato.
  const cursor = useRef<number | null>(null);
  const cursorPendiente = useRef<number | null>(null);

  useLayoutEffect(() => {
    const pendiente = cursorPendiente.current;
    if (pendiente === null || !textarea.current) return;
    cursorPendiente.current = null;
    textarea.current.focus();
    textarea.current.setSelectionRange(pendiente, pendiente);
  });

  const usadas = variablesUsadas(valor);

  const insertar = (variable: string) => {
    const resultado = insertarVariable(valor, cursor.current, variable);
    // Si no entra, no se corta el dato a la mitad.
    if (maxLength !== undefined && resultado.texto.length > maxLength) return;
    cursor.current = resultado.cursor;
    cursorPendiente.current = resultado.cursor;
    onCambio(resultado.texto);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border-[1.5px] bg-card focus-within:border-primary",
        invalido ? "border-danger" : "border-line-strong",
      )}
    >
      <div
        role="toolbar"
        aria-label="Insertar datos en el mensaje"
        className="flex items-center gap-1.5 overflow-x-auto border-b border-line bg-page px-2.5 py-2 md:flex-wrap"
      >
        <span className="mr-1 flex-none text-[13px] font-bold text-ink-secondary">Insertar:</span>
        {variables.map((variable) => {
          const usada = usadas.includes(variable);
          const falta = obligatorias.includes(variable) && !usada;
          return (
            <button
              key={variable}
              type="button"
              title={`Inserta {${variable}} donde está el cursor`}
              // Sin esto el textarea pierde el foco y con él la selección.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertar(variable)}
              className={cn(
                "inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold transition-colors",
                usada
                  ? "border-[#b5e3c6] bg-success-subtle text-success-text"
                  : falta
                    ? "border-primary bg-card text-ink hover:bg-primary-subtle"
                    : "border-line-strong bg-card text-ink hover:bg-sunken",
              )}
            >
              <Icono d={usada ? ["M20 6 9 17l-5-5"] : ["M12 5v14", "M5 12h14"]} />
              {ETIQUETAS_VARIABLE[variable]}
              {falta && (
                <span className="rounded-full bg-primary px-1.5 py-px text-[11px] font-bold text-primary-on">
                  obligatorio
                </span>
              )}
            </button>
          );
        })}
      </div>
      <textarea
        ref={textarea}
        id={id}
        rows={filas}
        maxLength={maxLength}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => {
          cursor.current = e.target.selectionStart;
          onCambio(e.target.value);
        }}
        onSelect={(e) => {
          cursor.current = e.currentTarget.selectionStart;
        }}
        aria-invalid={invalido ? true : undefined}
        aria-describedby={describedBy}
        className="block w-full resize-y border-0 bg-card px-4 py-3.5 text-[15px] leading-[1.55] text-ink outline-none"
      />
    </div>
  );
}
