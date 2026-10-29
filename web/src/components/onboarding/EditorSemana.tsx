"use client";

import type { SemanaState } from "@/app/contanos/useSemana";
import { cn } from "@/lib/cn";
import { cruzaMedianoche, DIAS_SEMANA, NOMBRE_DIA, type DiaSemana } from "@/lib/local";

/**
 * Una semana de franjas: cada día abre o no, con una franja o dos (el corte
 * del mediodía). La usan los horarios del local (ventas) y el horario de
 * atención del asistente (LAU-29), que en /cuenta conviven: `textos` les da
 * nombres accesibles distintos para que no se confundan.
 */
export type TextosSemana = {
  /** Nombre accesible del checkbox de cada día; sin esto, el nombre del día. */
  dia?: (nombre: string) => string;
  desde: string;
  hasta: string;
  cerrado: string;
  /** "del local", "del asistente": completa "Copiar el horario … del lunes". */
  deQuien?: string;
};

export const TEXTOS_LOCAL: TextosSemana = { desde: "abre", hasta: "cierra", cerrado: "Cerrado" };

const SELECT_HORA =
  "box-border min-h-10 rounded-sm border border-line bg-card px-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)]";

const BOTON_TEXTO = "min-h-9 cursor-pointer text-[13px] font-semibold text-primary-hover hover:underline";

function SelectorHora({
  valor,
  onChange,
  etiqueta,
  horas,
}: Readonly<{
  valor: string;
  onChange: (hora: string) => void;
  etiqueta: string;
  horas: readonly string[];
}>) {
  // Una hora guardada que no está en la grilla (09:15 cargado por API) se sigue mostrando.
  const opciones = horas.includes(valor) ? horas : [...horas, valor].sort((a, b) => a.localeCompare(b));
  return (
    <select aria-label={etiqueta} value={valor} onChange={(e) => onChange(e.target.value)} className={SELECT_HORA}>
      {opciones.map((hora) => (
        <option key={hora} value={hora}>
          {hora}
        </option>
      ))}
    </select>
  );
}

/** Cómo se nombra cada franja en las etiquetas: con corte, "(mañana)" y "(tarde)". */
const PARTES_CON_CORTE = ["mañana", "tarde"];

function FilaDia({
  semana,
  dia,
  textos,
  horas,
}: Readonly<{ semana: SemanaState; dia: DiaSemana; textos: TextosSemana; horas: readonly string[] }>) {
  const { abierto, franjas } = semana.semana[dia];
  const nombre = NOMBRE_DIA[dia];
  const problema = semana.problemas[dia];
  const partes = franjas.length > 1 ? PARTES_CON_CORTE : ["única"];
  const deQuien = textos.deQuien ? ` ${textos.deQuien}` : "";
  return (
    <li className="flex flex-col gap-2 border-b border-sunken py-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4">
      <label className="flex min-h-10 w-[130px] flex-none cursor-pointer items-center gap-2.5 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={abierto}
          onChange={() => semana.alternarDia(dia)}
          aria-label={textos.dia?.(nombre)}
          className="size-[18px] accent-[var(--color-semantic-primary-default)]"
        />
        {nombre}
      </label>
      {abierto ? (
        <div className="flex flex-1 flex-col gap-2">
          {franjas.map((franja, indice) => {
            const parte = partes[indice];
            const cual = franjas.length > 1 ? ` (${parte})` : "";
            const nocturna = semana.nocturnas && cruzaMedianoche(franja);
            return (
              <div key={parte} className="flex flex-wrap items-center gap-2">
                <SelectorHora
                  etiqueta={`${nombre}${cual}: ${textos.desde}`}
                  valor={franja.desde}
                  horas={horas}
                  onChange={(hora) => semana.fijarHora(dia, indice, "desde", hora)}
                />
                <span className="text-[13px] text-muted">a</span>
                <SelectorHora
                  etiqueta={`${nombre}${cual}: ${textos.hasta}`}
                  valor={franja.hasta}
                  horas={horas}
                  onChange={(hora) => semana.fijarHora(dia, indice, "hasta", hora)}
                />
                {nocturna && <span className="text-[13px] text-muted">del día siguiente</span>}
                {/* Una franja nocturna no tiene mediodía que cortar. */}
                {indice === franjas.length - 1 && !(franjas.length === 1 && nocturna) && (
                  <button
                    type="button"
                    onClick={() => (franjas.length > 1 ? semana.quitarCorte(dia) : semana.agregarCorte(dia))}
                    className={BOTON_TEXTO}
                  >
                    {franjas.length > 1 ? "Sin corte" : "Cierra al mediodía"}
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-3">
            {problema && (
              <p role="alert" className="text-[12.5px] text-danger-text">
                {problema}
              </p>
            )}
            <button
              type="button"
              onClick={() => semana.copiarATodos(dia)}
              aria-label={`Copiar el horario${deQuien} del ${nombre.toLowerCase()} a los demás días`}
              className={cn(BOTON_TEXTO, "text-ink-secondary")}
            >
              Copiar a los demás días
            </button>
          </div>
        </div>
      ) : (
        <span className="flex min-h-10 items-center text-[13.5px] text-muted">{textos.cerrado}</span>
      )}
    </li>
  );
}

export function EditorSemana({
  semana,
  leyenda,
  textos,
  horas,
}: Readonly<{ semana: SemanaState; leyenda: string; textos: TextosSemana; horas: readonly string[] }>) {
  return (
    <fieldset>
      <legend className="mb-1 text-[13px] font-semibold text-ink-secondary">{leyenda}</legend>
      <ul className="rounded-md border border-line bg-card px-3.5">
        {DIAS_SEMANA.map((dia) => (
          <FilaDia key={dia} semana={semana} dia={dia} textos={textos} horas={horas} />
        ))}
      </ul>
    </fieldset>
  );
}
