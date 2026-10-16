"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { DIAS_SEMANA, NOMBRE_DIA, type DiaSemana } from "@/lib/local";
import {
  MAX_HORARIOS_GRUPALES,
  horaDeFin,
  horariosDeBloques,
  textoDias,
  type BloqueClase,
} from "@/lib/turnos-grupales";

/**
 * Los horarios de un turno grupal, con el mismo formato en el paso de clases
 * de /contanos y en /reuniones: un horario por fila ("Lun, mié y vie · 18:00
 * ›") y "+ Agregar horario". Los días y la hora aparecen sólo al editar uno:
 * en una hoja que sube desde abajo en el celular, desplegado en el lugar de
 * su fila desde `md`. Un horario cerrado sin días se borra.
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

const FLECHA = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="flex-none text-muted">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const CAMPO =
  "box-border flex items-center rounded-sm border border-line bg-card text-[14px] text-ink focus-within:border-[var(--color-semantic-border-focus)]";

function slug(nombre: string): string {
  return nombre.replace(/[^a-zA-Z0-9]+/g, "-");
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export type CambiosHorarios = {
  onAlternarDia: (indice: number, dia: DiaSemana) => void;
  onFijarHora: (indice: number, hora: string) => void;
  /** Suma un horario sin días al final. */
  onAgregar: () => void;
  onQuitar: (indice: number) => void;
  /** Borra los horarios sin días (el que se cerró sin elegir ninguno). */
  onLimpiarVacios: () => void;
};

/** Un horario abierto para editar: días, hora, Quitar y Listo. */
function EditorHorario({
  nombre,
  duracionMin,
  bloque,
  indice,
  cambios,
  onCerrar,
  onQuitar,
}: {
  nombre: string;
  duracionMin: number;
  bloque: BloqueClase;
  indice: number;
  cambios: CambiosHorarios;
  onCerrar: () => void;
  onQuitar: () => void;
}) {
  const numero = indice + 1;
  const primerDia = useRef<HTMLButtonElement>(null);
  const sinDias = bloque.dias.length === 0;

  useEffect(() => {
    primerDia.current?.focus();
  }, []);

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
        aria-label={`Horario ${numero} de ${nombre}`}
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
          <span className="font-display text-[19px] font-bold text-ink">Horario de {nombre}</span>
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
            aria-label={`Días del horario ${numero} de ${nombre}`}
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
                  onClick={() => cambios.onAlternarDia(indice, dia)}
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
                onChange={(e) => e.target.value && cambios.onFijarHora(indice, e.target.value)}
                aria-label={`Hora del horario ${numero} de ${nombre}`}
                className="min-w-0 flex-1 bg-transparent text-[17px] font-bold text-ink tabular-nums outline-none md:w-[7.5rem] md:flex-none md:text-[15px]"
              />
            </span>
            <span className="text-[13px] text-muted">hasta {horaDeFin(bloque.hora, duracionMin)}</span>
          </span>
        </label>

        <div className="flex items-center gap-3 md:ml-auto">
          <button
            type="button"
            onClick={onQuitar}
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

/** Las filas de horario de un turno grupal, "+ Agregar horario" y el editor del que esté abierto. */
export function HorariosGrupales({
  nombre,
  duracionMin,
  bloques,
  cambios,
}: {
  nombre: string;
  duracionMin: number;
  bloques: BloqueClase[];
  cambios: CambiosHorarios;
}) {
  // Un solo horario abierto a la vez.
  const [editando, setEditando] = useState<number | null>(null);
  const lleno = horariosDeBloques(bloques).length >= MAX_HORARIOS_GRUPALES;
  const idAgregar = `agregar-horario-${slug(nombre)}`;
  const idFila = (indice: number) => `horario-${slug(nombre)}-${indice}`;

  /** Cierra el horario abierto (uno sin días se borra) y devuelve el foco a su fila. */
  function cerrar() {
    if (editando === null) return;
    const queda = (bloques[editando]?.dias.length ?? 0) > 0;
    const destino = queda ? idFila(editando) : idAgregar;
    cambios.onLimpiarVacios();
    setEditando(null);
    // Después del render: la fila vuelve a aparecer (o, si se borró, el "+ Agregar horario").
    requestAnimationFrame(() => document.getElementById(destino)?.focus());
  }

  /** Quita el horario abierto; el foco va a "+ Agregar horario". */
  function quitar(indice: number) {
    cambios.onQuitar(indice);
    setEditando(null);
    requestAnimationFrame(() => document.getElementById(idAgregar)?.focus());
  }

  /**
   * Abre un horario (`indice` igual a la cantidad = uno nuevo). El que estaba
   * abierto sin días se borra; como un horario sin días sólo puede ser el
   * último, borrarlo no corre el índice de las filas de antes.
   */
  function editar(indice: number) {
    const nuevo = indice >= bloques.length;
    if (editando !== null) {
      // Ya hay uno nuevo abierto: se sigue con ése.
      if (nuevo && bloques[editando]?.dias.length === 0) return;
      cambios.onLimpiarVacios();
    }
    if (nuevo) cambios.onAgregar();
    setEditando(indice);
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {bloques.map((bloque, indice) => {
        const abierto = editando === indice;
        const dias = bloque.dias.length > 0 ? conMayuscula(textoDias(bloque)) : "Sin días";
        return (
          <Fragment key={indice}>
            <button
              id={idFila(indice)}
              type="button"
              aria-expanded={abierto}
              aria-label={`Horario ${indice + 1} de ${nombre}: ${dias} ${bloque.hora}`}
              onClick={() => editar(indice)}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-sm border bg-page px-3 text-left text-ink md:min-h-11",
                abierto ? "border-primary md:hidden" : "border-line hover:border-line-strong",
              )}
            >
              <span className="min-w-0 flex-1 text-[14.5px]">{dias}</span>
              <span className="text-[15px] font-bold tabular-nums">{bloque.hora}</span>
              {FLECHA}
            </button>
            {abierto && (
              <EditorHorario
                nombre={nombre}
                duracionMin={duracionMin}
                bloque={bloque}
                indice={indice}
                cambios={cambios}
                onCerrar={cerrar}
                onQuitar={() => quitar(indice)}
              />
            )}
          </Fragment>
        );
      })}
      <button
        id={idAgregar}
        type="button"
        onClick={() => editar(bloques.length)}
        disabled={lleno}
        aria-label={`Agregar horario a ${nombre}`}
        className="min-h-11 cursor-pointer rounded-sm border-[1.5px] border-dashed border-line-strong bg-card px-3 text-[14px] font-semibold text-primary-hover hover:border-primary disabled:cursor-not-allowed disabled:text-muted"
      >
        + Agregar horario
      </button>
    </div>
  );
}
