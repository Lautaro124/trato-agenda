"use client";

import { chip } from "@/components/onboarding/controles";
import type { Periodo } from "@/lib/ventas";

const PERIODOS: Array<{ valor: Periodo; etiqueta: string }> = [
  { valor: "hoy", etiqueta: "Hoy" },
  { valor: "7", etiqueta: "7 días" },
  { valor: "30", etiqueta: "30 días" },
  { valor: "mes", etiqueta: "Este mes" },
  { valor: "personalizado", etiqueta: "Elegir fechas" },
];

const FECHA =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

export type Periodos = {
  periodo: Periodo;
  /** Sólo se usan con `periodo: "personalizado"`. */
  desde: string;
  hasta: string;
  incluirPrueba: boolean;
};

/**
 * La fila de arriba de todo: el período manda sobre los números, los gráficos
 * y el listado. La búsqueda y el estado van con el listado, que es lo único
 * que recortan.
 */
export function FiltrosVentas({
  filtros,
  hoy,
  onCambio,
}: {
  filtros: Periodos;
  /** "YYYY-MM-DD" de hoy, tope de las fechas elegibles. */
  hoy: string;
  onCambio: (cambio: Partial<Periodos>) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Período" className="flex flex-wrap gap-1.5">
          {PERIODOS.map(({ valor, etiqueta }) => (
            <button
              key={valor}
              type="button"
              aria-pressed={filtros.periodo === valor}
              onClick={() => onCambio({ periodo: valor })}
              className={chip(filtros.periodo === valor)}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        {filtros.periodo === "personalizado" && (
          <div className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
            <input
              type="date"
              aria-label="Desde"
              value={filtros.desde}
              max={filtros.hasta || hoy}
              onChange={(e) => onCambio({ desde: e.target.value })}
              className={FECHA}
            />
            <span aria-hidden="true">a</span>
            <input
              type="date"
              aria-label="Hasta"
              value={filtros.hasta}
              min={filtros.desde || undefined}
              max={hoy}
              onChange={(e) => onCambio({ hasta: e.target.value })}
              className={FECHA}
            />
          </div>
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-secondary select-none">
        <input
          type="checkbox"
          checked={filtros.incluirPrueba}
          onChange={(e) => onCambio({ incluirPrueba: e.target.checked })}
          className="size-4 accent-[var(--color-semantic-primary-default)]"
        />
        Incluir pedidos del chat de prueba
      </label>
    </div>
  );
}
