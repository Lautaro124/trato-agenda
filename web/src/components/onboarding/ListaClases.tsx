"use client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { DIAS_SEMANA, NOMBRE_DIA, type DiaSemana } from "@/lib/local";
import { HORAS_GRUPALES, MAX_HORARIOS_GRUPALES } from "@/lib/turnos-grupales";
import { LARGO_MAX_NOMBRE_EVENTO, MAX_TIPOS_EVENTO } from "@/app/contanos/useOnboarding";
import {
  CUPOS_SUGERIDOS,
  horariosDeClase,
  resumenClase,
  type BloqueClase,
  type Clase,
  type ClasesState,
} from "@/app/contanos/useClases";
import { CampoPrecio, SelectorDuracion } from "./controles";

/** Paso "¿Qué clases das?" de /contanos: las clases grupales, con su cupo y sus días. */

const INICIAL_DIA: Record<DiaSemana, string> = {
  lun: "L",
  mar: "M",
  mie: "M",
  jue: "J",
  vie: "V",
  sab: "S",
  dom: "D",
};

const ICONO_GRUPO = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-ink-secondary">
    <circle cx="9" cy="8" r="3.2" />
    <circle cx="16.5" cy="9" r="2.6" />
    <path d="M3 20c.9-3.3 3.3-5 6-5s5.1 1.7 6 5" />
    <path d="M15 14.6c2.6-.4 4.9 1.1 5.8 4.4" />
  </svg>
);

const TILDE = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** Un chip redondo (día o cupo): coral relleno cuando está elegido. */
function claseChip(activo: boolean): string {
  return cn(
    "cursor-pointer rounded-full border text-[13px] select-none",
    activo ? "border-primary bg-primary font-semibold text-primary-on" : "border-line bg-card text-ink hover:border-line-strong",
  );
}

/** Cupo: − / + y los atajos más comunes. */
function SelectorCupo({ ob, clase }: { ob: ClasesState; clase: Clase }) {
  const boton =
    "grid size-11 cursor-pointer place-items-center text-[18px] leading-none text-ink-secondary sm:size-8 sm:text-[16px]";
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <span className="text-[13.5px] font-semibold text-ink sm:w-[92px]">Cupo</span>
      <div
        role="group"
        aria-label={`Cupo de ${clase.nombre}`}
        className={cn(
          "flex items-center justify-between rounded-sm border bg-card sm:justify-start",
          clase.cupo === undefined ? "border-danger" : "border-line",
        )}
      >
        <button type="button" aria-label="Una persona menos" onClick={() => ob.moverCupo(clase.nombre, -1)} className={boton}>
          −
        </button>
        <output aria-live="polite" className="min-w-[92px] text-center font-mono text-[13px] font-semibold text-ink">
          {clase.cupo === undefined ? "—" : clase.cupo === 1 ? "1 persona" : `${clase.cupo} personas`}
        </output>
        <button type="button" aria-label="Una persona más" onClick={() => ob.moverCupo(clase.nombre, 1)} className={boton}>
          +
        </button>
      </div>
      <div className="flex gap-1.5">
        {CUPOS_SUGERIDOS.map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={clase.cupo === n}
            aria-label={`${n} personas en ${clase.nombre}`}
            onClick={() => ob.fijarCupo(clase.nombre, n)}
            className={cn(claseChip(clase.cupo === n), "min-h-10 flex-1 px-3 sm:min-h-0 sm:flex-none sm:py-[7px]")}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Un bloque de días con su hora: "L M M J V S D a las 18:00". */
function FilaBloque({
  ob,
  clase,
  bloque,
  indice,
}: {
  ob: ClasesState;
  clase: Clase;
  bloque: BloqueClase;
  indice: number;
}) {
  const numero = indice + 1;
  // Una hora guardada que no está en la grilla (18:10 cargado por API) se sigue mostrando.
  const horas = HORAS_GRUPALES.includes(bloque.hora)
    ? HORAS_GRUPALES
    : [...HORAS_GRUPALES, bloque.hora].sort((a, b) => a.localeCompare(b));
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center",
        indice > 0 && "border-t border-dashed border-line pt-3 sm:border-0 sm:pt-0",
      )}
    >
      <div className="flex items-center justify-between sm:w-[92px]">
        <span className="text-[13.5px] font-semibold text-ink">{indice === 0 ? "Días" : "Y también"}</span>
        {indice > 0 && (
          <button
            type="button"
            onClick={() => ob.quitarBloque(clase.nombre, indice)}
            aria-label={`Quitar el horario ${numero} de ${clase.nombre}`}
            className="min-h-9 cursor-pointer px-1 text-[13px] text-ink-secondary hover:text-danger-text hover:underline sm:hidden"
          >
            Quitar
          </button>
        )}
      </div>
      <div role="group" aria-label={`Días del horario ${numero} de ${clase.nombre}`} className="flex justify-between gap-1.5 sm:justify-start">
        {DIAS_SEMANA.map((dia) => {
          const activo = bloque.dias.includes(dia);
          return (
            <button
              key={dia}
              type="button"
              aria-pressed={activo}
              aria-label={NOMBRE_DIA[dia]}
              onClick={() => ob.alternarDia(clase.nombre, indice, dia)}
              className={cn(claseChip(activo), "grid size-10 place-items-center sm:size-[34px]")}
            >
              {INICIAL_DIA[dia]}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-[13.5px] text-ink-secondary">
        a las
        <select
          aria-label={`Hora del horario ${numero} de ${clase.nombre}`}
          value={bloque.hora}
          onChange={(e) => ob.fijarHora(clase.nombre, indice, e.target.value)}
          className="box-border min-h-10 flex-1 rounded-sm border border-line bg-card px-2 text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] sm:flex-none"
        >
          {horas.map((hora) => (
            <option key={hora} value={hora}>
              {hora}
            </option>
          ))}
        </select>
      </label>
      {indice > 0 && (
        <button
          type="button"
          onClick={() => ob.quitarBloque(clase.nombre, indice)}
          aria-label={`Quitar el horario ${numero} de ${clase.nombre}`}
          className="hidden min-h-9 cursor-pointer px-1 text-[13px] text-ink-secondary hover:text-danger-text hover:underline sm:block"
        >
          Quitar
        </button>
      )}
    </div>
  );
}

/**
 * Cupo y días de una clase elegida: plegados en una línea ("8 lugares · lun,
 * mié y vie 18:00") para que la lista no ocupe toda la pantalla, y abiertos
 * para editar. Una clase incompleta queda abierta: así se ve qué le falta.
 */
function CupoYDias({ ob, clase }: { ob: ClasesState; clase: Clase }) {
  const problema = ob.problemas[clase.nombre];
  const abierta = clase.abierta || Boolean(problema);
  const idPanel = `cupo-${clase.nombre.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  const lleno = horariosDeClase(clase).length >= MAX_HORARIOS_GRUPALES;
  return (
    <div>
      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={idPanel}
        aria-label={`Cupo y días de ${clase.nombre}`}
        onClick={() => ob.alternarPanel(clase.nombre)}
        className={cn(
          "flex min-h-11 w-full cursor-pointer items-center gap-2.5 border bg-card px-3 py-2 text-left",
          abierta ? "rounded-t-sm border-line" : "rounded-sm",
          !abierta && (problema ? "border-danger" : "border-line hover:border-line-strong"),
        )}
      >
        {ICONO_GRUPO}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            problema ? "font-semibold text-danger-text" : "text-ink",
          )}
        >
          {problema ? problema : resumenClase(clase)}
        </span>
        {!problema && (
          <span className="flex-none text-[13px] font-semibold text-primary-hover">{abierta ? "Cerrar" : "Editar"}</span>
        )}
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
      </button>
      {abierta && (
        <div id={idPanel} className="flex flex-col gap-3.5 rounded-b-sm border border-t-0 border-line bg-card p-3 sm:p-3.5">
          <SelectorCupo ob={ob} clase={clase} />
          {clase.bloques.map((bloque, indice) => (
            <FilaBloque key={indice} ob={ob} clase={clase} bloque={bloque} indice={indice} />
          ))}
          <button
            type="button"
            onClick={() => ob.agregarBloque(clase.nombre)}
            disabled={lleno}
            className="min-h-9 cursor-pointer self-start text-[13px] font-semibold text-primary-hover hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
          >
            + Otro día con otro horario
          </button>
          {!problema && (
            <Button variant="secondary" size="sm" onClick={() => ob.alternarPanel(clase.nombre)} className="self-end">
              Listo
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Una clase por fila, como los tipos de turno: tildarla muestra duración, precio, cupo y días. */
export function ListaClases({ ob }: { ob: ClasesState }) {
  return (
    <div className="flex flex-col gap-1.5">
      {ob.clases.map((clase) => (
        <div
          key={clase.nombre}
          className={cn(
            "flex flex-col gap-2.5 rounded-sm border px-[13px] py-[9px]",
            clase.activa ? "border-primary bg-primary-subtle" : "border-line bg-card hover:border-line-strong",
          )}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              aria-pressed={clase.activa}
              onClick={() => ob.alternar(clase.nombre)}
              className="flex min-h-8 min-w-[180px] flex-1 cursor-pointer items-center gap-2.5 text-left select-none"
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-[18px] flex-none place-items-center rounded-[6px] border",
                  clase.activa ? "border-primary bg-primary text-primary-on" : "border-line-strong bg-card",
                )}
              >
                {clase.activa && TILDE}
              </span>
              <span className={cn("min-w-0 flex-1 text-[14px] break-words text-ink", clase.activa && "font-semibold")}>
                {clase.nombre}
              </span>
              {!clase.activa && (
                <span aria-hidden className="flex-none rounded-full bg-sunken px-[9px] py-[3px] font-mono text-[11.5px] font-semibold text-muted">
                  {clase.duracionMin} min
                </span>
              )}
            </button>
            {clase.activa && (
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <SelectorDuracion
                  nombre={clase.nombre}
                  duracion={clase.duracionMin}
                  onChange={(min) => ob.fijarDuracion(clase.nombre, min)}
                />
                <div className="min-w-[140px] flex-1 sm:w-[120px] sm:flex-none">
                  <CampoPrecio
                    valor={clase.precio}
                    onChange={(precio) => ob.fijarPrecio(clase.nombre, precio)}
                    etiqueta={`Precio de ${clase.nombre}`}
                  />
                </div>
              </div>
            )}
          </div>
          {clase.activa && <CupoYDias ob={ob} clase={clase} />}
        </div>
      ))}
    </div>
  );
}

export function AgregarClase({ ob }: { ob: ClasesState }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={ob.personalizada}
          onChange={(e) => ob.setPersonalizada(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              ob.agregarPersonalizada();
            }
          }}
          maxLength={LARGO_MAX_NOMBRE_EVENTO}
          disabled={ob.llenas}
          aria-label="Nueva clase"
          placeholder="Agregar otra clase (ej.: stretching)"
          className="box-border min-w-0 flex-1 rounded-md border border-line bg-card px-[13px] py-[11px] font-body text-[13.5px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken"
        />
        <Button variant="secondary" size="md" onClick={ob.agregarPersonalizada} disabled={ob.llenas}>
          Agregar
        </Button>
      </div>
      {ob.llenas && <p className="mt-2 text-[12.5px] text-muted">Llegaste al máximo de {MAX_TIPOS_EVENTO} clases.</p>}
    </div>
  );
}
