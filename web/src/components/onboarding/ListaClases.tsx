"use client";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { leerCapacidad } from "@/lib/turnos-grupales";
import { DURACIONES, LARGO_MAX_NOMBRE_EVENTO, MAX_TIPOS_EVENTO } from "@/app/contanos/useOnboarding";
import { ORIGENES_CLASES, type Clase, type ClasesState, type OrigenClases } from "@/app/contanos/useClases";
import { CampoPrecio } from "./controles";
import { HorariosGrupales } from "./HorariosGrupales";

/**
 * Paso "¿Qué clases das?" de /contanos. Cada clase elegida muestra a la vista
 * lo que tiene un solo valor (duración, cupo, precio) y sus horarios con
 * `HorariosGrupales`, el mismo editor que usa /reuniones.
 */

const ICONO_GRUPO = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

const CAMPO =
  "box-border flex h-10 items-center rounded-sm border border-line bg-card text-[14px] text-ink focus-within:border-[var(--color-semantic-border-focus)]";

/** "Empezar con": las ideas para tildar o una lista propia, sin ninguna clase armada. */
function EmpezarConClases({ origen: elegido, onElegir }: { origen: OrigenClases; onElegir: (origen: OrigenClases) => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span id="empezar-con-clases" className="text-[13px] font-semibold text-ink-secondary">
        Empezar con
      </span>
      <div
        role="radiogroup"
        aria-labelledby="empezar-con-clases"
        className="grid grid-cols-2 gap-0.5 rounded-md bg-sunken p-[3px] sm:inline-grid"
      >
        {ORIGENES_CLASES.map((origen) => {
          const activo = origen.id === elegido;
          return (
            <button
              key={origen.id}
              type="button"
              role="radio"
              aria-checked={activo}
              onClick={() => !activo && onElegir(origen.id)}
              className={cn(
                "min-h-9 cursor-pointer rounded-sm px-3.5 text-[13px] whitespace-nowrap",
                activo ? "bg-card font-bold text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
              )}
            >
              {origen.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Duración en un select: las de siempre, más la guardada si no está entre ellas. */
function SelectDuracion({ ob, clase }: { ob: ClasesState; clase: Clase }) {
  const opciones = DURACIONES.includes(clase.duracionMin)
    ? DURACIONES
    : [...DURACIONES, clase.duracionMin].sort((a, b) => a - b);
  return (
    <label className="flex items-center gap-2 text-[13.5px] text-ink-secondary">
      Dura
      <select
        aria-label={`Duración de ${clase.nombre}`}
        value={clase.duracionMin}
        onChange={(e) => ob.fijarDuracion(clase.nombre, Number(e.target.value))}
        className={cn(CAMPO, "cursor-pointer px-2 font-semibold outline-none")}
      >
        {opciones.map((min) => (
          <option key={min} value={min}>
            {min} min
          </option>
        ))}
      </select>
    </label>
  );
}

/** Cupo en un solo campo: "Entran [8] personas". */
function CampoCupo({ ob, clase }: { ob: ClasesState; clase: Clase }) {
  return (
    <label className="flex items-center gap-2 text-[13.5px] text-ink-secondary">
      Entran
      <span className={cn(CAMPO, "gap-1.5 px-2.5", clase.cupo === undefined && "border-danger")}>
        <input
          value={clase.cupo === undefined ? "" : String(clase.cupo)}
          onChange={(e) => ob.fijarCupo(clase.nombre, leerCapacidad(e.target.value))}
          inputMode="numeric"
          autoComplete="off"
          aria-label={`Personas por clase de ${clase.nombre}`}
          placeholder="—"
          className="w-8 bg-transparent text-right font-bold text-ink outline-none placeholder:text-muted"
        />
        <span>personas</span>
      </span>
    </label>
  );
}

/** Una clase elegida: encabezado con duración, cupo y precio, y debajo sus horarios. */
function TarjetaClase({
  ob,
  clase,
}: {
  ob: ClasesState;
  clase: Clase;
}) {
  const problema = ob.problemas[clase.nombre];
  const propia = ob.origen === "propia";
  return (
    <div className="flex flex-col gap-3 rounded-md border-[1.5px] border-primary bg-primary-subtle p-3 md:p-3.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        {propia ? (
          <div className="flex min-h-8 min-w-0 basis-full items-center gap-2">
            <span className="min-w-0 flex-1 text-[15px] font-bold break-words text-ink">{clase.nombre}</span>
            <button
              type="button"
              onClick={() => ob.quitarClase(clase.nombre)}
              aria-label={`Quitar ${clase.nombre}`}
              className="grid size-9 flex-none cursor-pointer place-items-center rounded-sm text-ink-secondary hover:bg-card hover:text-danger-text"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-pressed
            onClick={() => ob.alternar(clase.nombre)}
            className="flex min-h-8 min-w-0 basis-full cursor-pointer items-center gap-2.5 text-left select-none"
          >
            <span aria-hidden className="grid size-[18px] flex-none place-items-center rounded-[6px] border border-primary bg-primary text-primary-on">
              {TILDE}
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-bold break-words text-ink">{clase.nombre}</span>
          </button>
        )}
        <SelectDuracion ob={ob} clase={clase} />
        <CampoCupo ob={ob} clase={clase} />
        <div className="min-w-[110px] flex-1 md:max-w-[140px]">
          <CampoPrecio
            valor={clase.precio}
            onChange={(precio) => ob.fijarPrecio(clase.nombre, precio)}
            etiqueta={`Precio de ${clase.nombre}`}
            placeholder="Precio"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2.5 rounded-sm border border-line bg-card p-3 md:p-3.5">
        <span className="text-[13.5px] font-semibold text-ink">¿Cuándo es?</span>
        <HorariosGrupales
          nombre={clase.nombre}
          duracionMin={clase.duracionMin}
          bloques={clase.bloques}
          cambios={{
            onAlternarDia: (indice, dia) => ob.alternarDia(clase.nombre, indice, dia),
            onFijarHora: (indice, hora) => ob.fijarHora(clase.nombre, indice, hora),
            onAgregar: () => ob.agregarBloque(clase.nombre),
            onQuitar: (indice) => ob.quitarBloque(clase.nombre, indice),
            onLimpiarVacios: () => ob.limpiarBloquesVacios(clase.nombre),
          }}
        />
      </div>
      {problema && <p className="text-[12.5px] font-semibold text-danger-text">{problema}</p>}
    </div>
  );
}

/** El campo para sumar una clase que no está entre las ideas (o la primera, en la lista propia). */
function AgregarClase({ ob, etiqueta }: { ob: ClasesState; etiqueta: string }) {
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
          aria-label={etiqueta}
          placeholder="Nombre de la clase (ej.: stretching)"
          className="box-border min-w-0 flex-1 rounded-md border border-line bg-card px-[13px] py-[11px] font-body text-[14px] text-ink outline-none focus:border-[var(--color-semantic-border-focus)] disabled:bg-sunken"
        />
        <Button variant="secondary" size="md" onClick={ob.agregarPersonalizada} disabled={ob.llenas}>
          Agregar
        </Button>
      </div>
      {ob.llenas && <p className="mt-2 text-[12.5px] text-muted">Llegaste al máximo de {MAX_TIPOS_EVENTO} clases.</p>}
    </div>
  );
}

/** "Mi propia lista" sin nada todavía: el lugar para escribir la primera clase. */
function ListaPropiaVacia({ ob }: { ob: ClasesState }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-md border-[1.5px] border-dashed border-line-strong bg-card px-4 py-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <span aria-hidden className="mb-1.5 grid size-11 place-items-center rounded-full bg-primary-subtle text-primary-hover">
          {ICONO_GRUPO}
        </span>
        <span className="text-[15.5px] font-bold text-ink">Todavía no agregaste clases</span>
        <span className="text-[13.5px] text-ink-secondary">Escribí el nombre como lo dicen tus alumnos.</span>
      </div>
      <AgregarClase ob={ob} etiqueta="Nombre de la clase" />
    </div>
  );
}

/** Las clases del paso: las elegidas como tarjetas, las ideas sin elegir debajo y el campo para sumar otra. */
export function ListaClases({ ob }: { ob: ClasesState }) {
  const activas = ob.activas;
  const ideas = ob.origen === "ideas" ? ob.sinElegir : [];
  const vacia = ob.origen === "propia" && ob.clases.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="mb-1">
        <EmpezarConClases origen={ob.origen} onElegir={ob.elegirOrigen} />
      </div>
      {vacia && <ListaPropiaVacia ob={ob} />}
      {activas.map((clase) => (
        <TarjetaClase key={clase.nombre} ob={ob} clase={clase} />
      ))}

      {!vacia && <div className="flex flex-col gap-2">
        {activas.length > 0 && <span className="text-[13.5px] font-semibold text-ink-secondary">¿Das alguna más?</span>}
        {ideas.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
            {ideas.map((clase) => (
              <button
                key={clase.nombre}
                type="button"
                aria-pressed={false}
                onClick={() => ob.alternar(clase.nombre)}
                disabled={ob.llenas}
                className="flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-md border border-line bg-card px-3 text-left select-none hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span aria-hidden className="size-[18px] flex-none rounded-[6px] border border-line-strong bg-card" />
                <span className="min-w-0 flex-1 text-[14.5px] break-words text-ink">{clase.nombre}</span>
                <span aria-hidden className="flex-none text-[12.5px] text-muted">
                  {clase.duracionMin} min
                </span>
              </button>
            ))}
          </div>
        )}
        <AgregarClase ob={ob} etiqueta="Nueva clase" />
      </div>}
    </div>
  );
}
