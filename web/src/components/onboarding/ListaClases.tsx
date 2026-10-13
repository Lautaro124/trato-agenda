"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { DIAS_SEMANA, NOMBRE_DIA, type DiaSemana } from "@/lib/local";
import { leerCapacidad, MAX_HORARIOS_GRUPALES } from "@/lib/turnos-grupales";
import { DURACIONES, LARGO_MAX_NOMBRE_EVENTO, MAX_TIPOS_EVENTO } from "@/app/contanos/useOnboarding";
import {
  ORIGENES_CLASES,
  horaDeFin,
  horariosDeClase,
  textoDias,
  type Clase,
  type ClasesState,
  type OrigenClases,
} from "@/app/contanos/useClases";
import { CampoPrecio } from "./controles";

/**
 * Paso "¿Qué clases das?" de /contanos. Cada clase elegida muestra a la vista
 * lo que tiene un solo valor (duración, cupo, precio) y sus horarios como
 * filas de resumen; los días aparecen sólo al editar un horario: en una hoja
 * que sube desde abajo en el celular, desplegado en su lugar desde `md`.
 */

const CORTO_DIA: Record<DiaSemana, string> = {
  lun: "Lun",
  mar: "Mar",
  mie: "Mié",
  jue: "Jue",
  vie: "Vie",
  sab: "Sáb",
  dom: "Dom",
};

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

const FLECHA = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-muted">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const CAMPO =
  "box-border flex h-10 items-center rounded-sm border border-line bg-card text-[14px] text-ink focus-within:border-[var(--color-semantic-border-focus)]";

/** Un id estable para un horario: para devolverle el foco al cerrar el editor. */
function idHorario(nombre: string, indice: number): string {
  return `horario-${nombre.replace(/[^a-zA-Z0-9]+/g, "-")}-${indice}`;
}

function idAgregarHorario(nombre: string): string {
  return `agregar-horario-${nombre.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

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

/**
 * Un horario abierto para editar: días, hora, Quitar y Listo. En el celular
 * es una hoja que sube desde abajo; desde `md` ocupa el lugar de su fila.
 */
function EditorHorario({
  ob,
  clase,
  indice,
  onCerrar,
}: {
  ob: ClasesState;
  clase: Clase;
  indice: number;
  onCerrar: () => void;
}) {
  const bloque = clase.bloques[indice];
  const numero = indice + 1;
  const primerDia = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primerDia.current?.focus();
  }, []);

  if (!bloque) return null;
  const sinDias = bloque.dias.length === 0;

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar el horario"
        onClick={onCerrar}
        className="fixed inset-0 z-40 cursor-default bg-[rgba(26,25,23,0.45)] md:hidden"
      />
      <div
        role="dialog"
        aria-label={`Horario ${numero} de ${clase.nombre}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCerrar();
          }
        }}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex flex-col gap-4 rounded-t-[20px] bg-card px-5 pt-2.5 pb-[max(24px,env(safe-area-inset-bottom))] shadow-lg",
          "md:static md:z-auto md:col-span-2 md:flex-row md:flex-wrap md:items-center md:gap-x-5 md:gap-y-3 md:rounded-sm md:border-[1.5px] md:border-primary md:px-3.5 md:py-3 md:shadow-none",
        )}
      >
        <span aria-hidden className="h-1 w-10 self-center rounded-full bg-line-strong md:hidden" />
        <div className="flex items-center justify-between md:hidden">
          <span className="font-display text-[19px] font-bold text-ink">Horario de {clase.nombre}</span>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="-mr-2.5 grid size-11 cursor-pointer place-items-center text-ink-secondary"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
          <span className="text-[14px] font-semibold text-ink md:sr-only">¿Qué días?</span>
          <div
            role="group"
            aria-label={`Días del horario ${numero} de ${clase.nombre}`}
            className="grid grid-cols-7 gap-1.5 md:flex md:gap-1"
          >
            {DIAS_SEMANA.map((dia, i) => {
              const activo = bloque.dias.includes(dia);
              return (
                <button
                  key={dia}
                  ref={i === 0 ? primerDia : undefined}
                  type="button"
                  aria-pressed={activo}
                  aria-label={NOMBRE_DIA[dia]}
                  onClick={() => ob.alternarDia(clase.nombre, indice, dia)}
                  className={cn(
                    "h-11 cursor-pointer rounded-sm border text-[13px] select-none md:h-9 md:w-11 md:text-[12.5px]",
                    activo
                      ? "border-primary bg-primary font-bold text-primary-on"
                      : "border-line bg-card text-ink hover:border-line-strong",
                  )}
                >
                  {CORTO_DIA[dia]}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-2.5 md:flex-row md:items-center md:gap-2">
          <span className="text-[14px] font-semibold text-ink md:font-normal md:text-ink-secondary">
            <span className="md:hidden">¿A qué hora empieza?</span>
            <span className="hidden md:inline">a las</span>
          </span>
          <span className="flex items-center gap-2.5">
            <span className={cn(CAMPO, "h-12 flex-1 px-3 md:h-9 md:flex-none")}>
              <input
                type="time"
                step={900}
                value={bloque.hora}
                onChange={(e) => e.target.value && ob.fijarHora(clase.nombre, indice, e.target.value)}
                aria-label={`Hora del horario ${numero} de ${clase.nombre}`}
                className="min-w-0 flex-1 bg-transparent text-[17px] font-bold text-ink tabular-nums outline-none md:w-[7.5rem] md:flex-none md:text-[15px]"
              />
            </span>
            <span className="text-[13px] text-muted">hasta {horaDeFin(bloque.hora, clase.duracionMin)}</span>
          </span>
        </label>

        <div className="flex items-center gap-3 md:ml-auto">
          <button
            type="button"
            onClick={() => {
              ob.quitarBloque(clase.nombre, indice);
              onCerrar();
            }}
            className="min-h-11 cursor-pointer px-2 text-[14px] font-semibold text-danger-text hover:underline md:min-h-9"
          >
            Quitar
          </button>
          {sinDias && <span className="hidden text-[12.5px] text-muted md:inline">Elegí al menos un día</span>}
          <Button size="md" onClick={onCerrar} disabled={sinDias} className="flex-1 md:flex-none">
            Listo
          </Button>
        </div>
      </div>
    </>
  );
}

/** Una clase elegida: encabezado con duración, cupo y precio, y debajo sus horarios. */
function TarjetaClase({
  ob,
  clase,
  editando,
  onEditar,
  onCerrar,
  onSoltar,
}: {
  ob: ClasesState;
  clase: Clase;
  editando: number | null;
  onEditar: (indice: number) => void;
  onCerrar: () => void;
  onSoltar: () => void;
}) {
  const problema = ob.problemas[clase.nombre];
  const lleno = horariosDeClase(clase).length >= MAX_HORARIOS_GRUPALES;
  const propia = ob.origen === "propia";
  return (
    <div className="flex flex-col gap-3 rounded-md border-[1.5px] border-primary bg-primary-subtle p-3 md:p-3.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        {propia ? (
          <div className="flex min-h-8 min-w-0 basis-full items-center gap-2">
            <span className="min-w-0 flex-1 text-[15px] font-bold break-words text-ink">{clase.nombre}</span>
            <button
              type="button"
              onClick={() => {
                onSoltar();
                ob.quitarClase(clase.nombre);
              }}
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
            onClick={() => {
              onSoltar();
              ob.alternar(clase.nombre);
            }}
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
        <div className="grid gap-2 md:grid-cols-2">
          {clase.bloques.map((bloque, indice) => {
            const abierto = editando === indice;
            const dias = bloque.dias.length > 0 ? conMayuscula(textoDias(bloque)) : "Sin días";
            return (
              <Fragment key={indice}>
                <button
                  id={idHorario(clase.nombre, indice)}
                  type="button"
                  aria-expanded={abierto}
                  aria-label={`Horario ${indice + 1} de ${clase.nombre}: ${dias} ${bloque.hora}`}
                  onClick={() => onEditar(indice)}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-sm border bg-page px-3 text-left text-ink md:min-h-11",
                    abierto ? "border-primary md:hidden" : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="min-w-0 flex-1 text-[14.5px]">{dias}</span>
                  <span className="text-[15px] font-bold tabular-nums">{bloque.hora}</span>
                  {FLECHA}
                </button>
                {abierto && <EditorHorario ob={ob} clase={clase} indice={indice} onCerrar={onCerrar} />}
              </Fragment>
            );
          })}
          <button
            id={idAgregarHorario(clase.nombre)}
            type="button"
            onClick={() => onEditar(clase.bloques.length)}
            disabled={lleno}
            aria-label={`Agregar horario a ${clase.nombre}`}
            className="min-h-11 cursor-pointer rounded-sm border-[1.5px] border-dashed border-line-strong bg-card px-3 text-[14px] font-semibold text-primary-hover hover:border-primary disabled:cursor-not-allowed disabled:text-muted"
          >
            + Agregar horario
          </button>
        </div>
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
  // Un solo horario abierto a la vez, en toda la lista.
  const [editando, setEditando] = useState<{ nombre: string; indice: number } | null>(null);

  /** Cierra el horario abierto; uno sin días se borra (`limpiarBloquesVacios`). */
  function cerrar() {
    if (!editando) return;
    const { nombre, indice } = editando;
    const bloque = ob.clases.find((clase) => clase.nombre === nombre)?.bloques[indice];
    ob.limpiarBloquesVacios(nombre);
    setEditando(null);
    // Después del render: la fila vuelve a aparecer (o, si se borró, el "+ Agregar horario").
    requestAnimationFrame(() => {
      const destino =
        bloque && bloque.dias.length > 0 ? idHorario(nombre, indice) : idAgregarHorario(nombre);
      document.getElementById(destino)?.focus();
    });
  }

  /**
   * Abre un horario (`indice` igual a la cantidad = uno nuevo). El que estaba
   * abierto sin días se borra; como un horario sin días sólo puede ser el
   * último de su clase, borrarlo no corre el índice de las filas de antes.
   */
  function editar(nombre: string, indice: number) {
    const clase = ob.clases.find((c) => c.nombre === nombre);
    if (!clase) return;
    const nuevo = indice >= clase.bloques.length;
    if (editando) {
      const previo = ob.clases.find((c) => c.nombre === editando.nombre)?.bloques[editando.indice];
      // Ya hay uno nuevo abierto en esta clase: se sigue con ése.
      if (nuevo && editando.nombre === nombre && previo?.dias.length === 0) return;
      ob.limpiarBloquesVacios(editando.nombre);
    }
    if (nuevo) ob.agregarBloque(nombre);
    setEditando({ nombre, indice });
  }

  /** Destildar o quitar una clase cierra su horario abierto, si tenía. */
  function soltar(nombre: string) {
    if (editando?.nombre === nombre) setEditando(null);
  }

  function elegirOrigen(origen: OrigenClases) {
    setEditando(null);
    ob.elegirOrigen(origen);
  }

  const activas = ob.activas;
  const ideas = ob.origen === "ideas" ? ob.sinElegir : [];
  const vacia = ob.origen === "propia" && ob.clases.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="mb-1">
        <EmpezarConClases origen={ob.origen} onElegir={elegirOrigen} />
      </div>
      {vacia && <ListaPropiaVacia ob={ob} />}
      {activas.map((clase) => (
        <TarjetaClase
          key={clase.nombre}
          ob={ob}
          clase={clase}
          editando={editando?.nombre === clase.nombre ? editando.indice : null}
          onEditar={(indice) => editar(clase.nombre, indice)}
          onCerrar={cerrar}
          onSoltar={() => soltar(clase.nombre)}
        />
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
