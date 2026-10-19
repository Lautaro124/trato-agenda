"use client";

import { cn } from "@/lib/cn";

export const ICONO_QUITAR = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

/**
 * Una lista de textos cortos como pastillas que se quitan con una cruz, con
 * un campo al final para sumar otra (Enter o "Agregar"). La usan las
 * opciones de cada pregunta y los materiales del producto a medida.
 */
export function ListaDePastillas({
  items,
  nombreLista,
  nombreNuevo,
  placeholder,
  nuevo,
  largoMaximo,
  llena,
  onNuevo,
  onAgregar,
  onQuitar,
}: Readonly<{
  items: string[];
  /** Nombre accesible de la lista ("Opciones", "Materiales"). */
  nombreLista: string;
  /** Nombre accesible del campo ("Nueva opción", "Nuevo material"). */
  nombreNuevo: string;
  placeholder: string;
  nuevo: string;
  largoMaximo: number;
  llena: boolean;
  onNuevo: (texto: string) => void;
  onAgregar: () => void;
  onQuitar: (indice: number) => void;
}>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.length > 0 && (
        <ul aria-label={nombreLista} className="contents">
          {items.map((item, indice) => (
            <li
              key={`${item}-${indice}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primitive-coral-200)] bg-primary-subtle py-1 pr-1 pl-3 text-[13.5px] text-ink"
            >
              {item}
              <button
                type="button"
                aria-label={`Quitar ${item}`}
                onClick={() => onQuitar(indice)}
                className="grid size-6 cursor-pointer place-items-center rounded-full text-[var(--color-primitive-coral-700)] hover:bg-card"
              >
                {ICONO_QUITAR}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!llena && (
        <span className="inline-flex items-center gap-1">
          <input
            aria-label={nombreNuevo}
            value={nuevo}
            maxLength={largoMaximo}
            placeholder={placeholder}
            onChange={(e) => onNuevo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Enter suma la pastilla; no manda el formulario.
              e.preventDefault();
              onAgregar();
            }}
            className={cn(
              "w-40 rounded-full border border-dashed border-line-strong bg-card px-3 py-1 text-[13.5px] text-ink outline-none",
              "focus:border-solid focus:border-[var(--color-semantic-border-focus)]",
            )}
          />
          {nuevo.trim() && (
            <button
              type="button"
              onClick={onAgregar}
              className="cursor-pointer rounded-full px-2 py-1 text-[13px] font-semibold text-primary hover:bg-primary-subtle"
            >
              Agregar
            </button>
          )}
        </span>
      )}
    </div>
  );
}
