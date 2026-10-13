"use client";

import { useCallback, useMemo, useState } from "react";
import type { DiaSemana } from "@/lib/local";
import {
  MAX_HORARIOS_GRUPALES,
  bloquesDeHorarios,
  horariosDeBloques,
  problemaDeBloques,
  type BloqueClase,
  type HorarioGrupal,
} from "@/lib/turnos-grupales";
import {
  LARGO_MAX_NOMBRE_EVENTO,
  LARGO_MIN_NOMBRE_EVENTO,
  MAX_TIPOS_EVENTO,
  type TipoEvento,
} from "./useOnboarding";

/**
 * Las clases grupales del paso "¿Qué clases das?" de /contanos. Cada clase es
 * un tipo de turno grupal (`TipoEvento` con `capacidad` y `horarios`); en
 * pantalla sus horarios son bloques (`BloqueClase`, en lib/turnos-grupales).
 */

export type Clase = {
  nombre: string;
  duracionMin: number;
  precio?: number;
  /** Cuántas personas entran. Sin escribir todavía: `undefined`. */
  cupo?: number;
  bloques: BloqueClase[];
  activa: boolean;
};

/**
 * "Empezar con": las ideas del catálogo (para tildar) o una lista propia,
 * sin ninguna clase armada. Como en los turnos individuales, cambiarlo
 * reinicia lo elegido.
 */
export type OrigenClases = "ideas" | "propia";

export const ORIGENES_CLASES: Array<{ id: OrigenClases; label: string }> = [
  { id: "ideas", label: "Ideas de clases" },
  { id: "propia", label: "Mi propia lista" },
];

/** Ideas para arrancar: las clases más comunes, con su duración típica. */
export const CATALOGO_CLASES: Array<{ nombre: string; duracionMin: number }> = [
  { nombre: "Yoga", duracionMin: 60 },
  { nombre: "Pilates", duracionMin: 45 },
  { nombre: "Funcional", duracionMin: 60 },
  { nombre: "Taller", duracionMin: 90 },
];

/** La hora con la que arranca el primer horario de una clase. */
const HORA_INICIAL = "18:00";

function claseNueva(nombre: string, duracionMin: number, activa: boolean): Clase {
  return { nombre, duracionMin, bloques: [], activa };
}

function ideasDelCatalogo(): Clase[] {
  return CATALOGO_CLASES.map((idea) => claseNueva(idea.nombre, idea.duracionMin, false));
}

/** Los horarios de una clase: uno por día de cada bloque. */
export function horariosDeClase(clase: Pick<Clase, "bloques">): HorarioGrupal[] {
  return horariosDeBloques(clase.bloques);
}

/** Qué le falta a una clase elegida para poder guardarla, o null. */
export function problemaDeClase(clase: Clase): string | null {
  if (clase.cupo === undefined) return "Escribí cuántas personas entran.";
  if (clase.bloques.length === 0) return "Agregá al menos un horario.";
  return problemaDeBloques(clase.duracionMin, clase.cupo, clase.bloques);
}

/**
 * El estado de las clases. `inicial` son tipos de turno grupales ya guardados
 * (vuelven elegidos); el catálogo de ideas se suma sin elegir.
 */
export function useClases(inicial: TipoEvento[] = []) {
  const [origen, setOrigen] = useState<OrigenClases>("ideas");
  const [clases, setClases] = useState<Clase[]>(() => {
    const guardadas = inicial
      .filter((tipo) => tipo.capacidad !== undefined)
      .map((tipo): Clase => ({
        nombre: tipo.nombre,
        duracionMin: tipo.duracionMin,
        ...(tipo.precio === undefined ? {} : { precio: tipo.precio }),
        cupo: tipo.capacidad,
        bloques: bloquesDeHorarios(tipo.horarios ?? []),
        activa: true,
      }));
    const ideas = ideasDelCatalogo().filter(
      (idea) => !guardadas.some((clase) => clase.nombre.toLowerCase() === idea.nombre.toLowerCase()),
    );
    return [...guardadas, ...ideas];
  });
  const [personalizada, setPersonalizada] = useState("");

  /** Cambiar de origen reinicia la lista: las ideas sin tildar, o nada. */
  const elegirOrigen = useCallback((nuevo: OrigenClases) => {
    setOrigen(nuevo);
    setClases(nuevo === "ideas" ? ideasDelCatalogo() : []);
    setPersonalizada("");
  }, []);

  /** Cambia una clase por su nombre (los nombres no se repiten). */
  const cambiar = useCallback((nombre: string, cambio: (clase: Clase) => Clase) => {
    setClases((previas) => previas.map((clase) => (clase.nombre === nombre ? cambio(clase) : clase)));
  }, []);

  const alternar = useCallback(
    (nombre: string) =>
      setClases((previas) => {
        const activas = previas.filter((clase) => clase.activa).length;
        return previas.map((clase) => {
          if (clase.nombre !== nombre) return clase;
          if (!clase.activa && activas >= MAX_TIPOS_EVENTO) return clase;
          return { ...clase, activa: !clase.activa };
        });
      }),
    [],
  );

  /** En "Mi propia lista" no hay nada que destildar: la clase se borra. */
  const quitarClase = useCallback(
    (nombre: string) => setClases((previas) => previas.filter((clase) => clase.nombre !== nombre)),
    [],
  );

  const fijarDuracion = useCallback(
    (nombre: string, duracionMin: number) => cambiar(nombre, (clase) => ({ ...clase, duracionMin })),
    [cambiar],
  );

  const fijarPrecio = useCallback(
    (nombre: string, precio: number | undefined) => cambiar(nombre, (clase) => ({ ...clase, precio })),
    [cambiar],
  );

  /** Lo que se escribió, sin acotar: si se pasa del rango, `problemaGrupal` dice cuál es. */
  const fijarCupo = useCallback(
    (nombre: string, cupo: number | undefined) => cambiar(nombre, (clase) => ({ ...clase, cupo })),
    [cambiar],
  );

  const alternarDia = useCallback(
    (nombre: string, indice: number, dia: DiaSemana) =>
      cambiar(nombre, (clase) => ({
        ...clase,
        bloques: clase.bloques.map((bloque, i) =>
          i !== indice
            ? bloque
            : { ...bloque, dias: bloque.dias.includes(dia) ? bloque.dias.filter((d) => d !== dia) : [...bloque.dias, dia] },
        ),
      })),
    [cambiar],
  );

  const fijarHora = useCallback(
    (nombre: string, indice: number, hora: string) =>
      cambiar(nombre, (clase) => ({
        ...clase,
        bloques: clase.bloques.map((bloque, i) => (i === indice ? { ...bloque, hora } : bloque)),
      })),
    [cambiar],
  );

  /** Un horario nuevo, sin días, a la hora del último (o 18:00 si es el primero). */
  const agregarBloque = useCallback(
    (nombre: string) =>
      cambiar(nombre, (clase) =>
        horariosDeClase(clase).length >= MAX_HORARIOS_GRUPALES
          ? clase
          : { ...clase, bloques: [...clase.bloques, { dias: [], hora: clase.bloques.at(-1)?.hora ?? HORA_INICIAL }] },
      ),
    [cambiar],
  );

  const quitarBloque = useCallback(
    (nombre: string, indice: number) =>
      cambiar(nombre, (clase) => ({ ...clase, bloques: clase.bloques.filter((_, i) => i !== indice) })),
    [cambiar],
  );

  /** Al cerrar el editor, un horario al que no se le eligió ningún día no queda dando vueltas. */
  const limpiarBloquesVacios = useCallback(
    (nombre: string) =>
      cambiar(nombre, (clase) =>
        clase.bloques.some((bloque) => bloque.dias.length === 0)
          ? { ...clase, bloques: clase.bloques.filter((bloque) => bloque.dias.length > 0) }
          : clase,
      ),
    [cambiar],
  );

  const agregarPersonalizada = useCallback(() => {
    const nombre = personalizada.trim().slice(0, LARGO_MAX_NOMBRE_EVENTO);
    if (nombre.length < LARGO_MIN_NOMBRE_EVENTO) return;
    setClases((previas) => {
      const existente = previas.find((clase) => clase.nombre.toLowerCase() === nombre.toLowerCase());
      if (existente) {
        return previas.map((clase) => (clase === existente ? { ...clase, activa: true } : clase));
      }
      if (previas.filter((clase) => clase.activa).length >= MAX_TIPOS_EVENTO) return previas;
      return [...previas, claseNueva(nombre, 60, true)];
    });
    setPersonalizada("");
  }, [personalizada]);

  const activas = useMemo(() => clases.filter((clase) => clase.activa), [clases]);
  const sinElegir = useMemo(() => clases.filter((clase) => !clase.activa), [clases]);

  /** nombre → qué le falta. Sólo las elegidas. */
  const problemas = useMemo(
    () =>
      Object.fromEntries(
        activas.flatMap((clase) => {
          const problema = problemaDeClase(clase);
          return problema ? [[clase.nombre, problema]] : [];
        }),
      ) as Record<string, string>,
    [activas],
  );

  /** Lo que viaja a la API: un tipo de turno grupal por clase elegida. */
  const seleccionadas: TipoEvento[] = useMemo(
    () =>
      activas.map((clase) => ({
        nombre: clase.nombre,
        duracionMin: clase.duracionMin,
        ...(clase.precio === undefined ? {} : { precio: clase.precio }),
        capacidad: clase.cupo,
        horarios: horariosDeClase(clase),
      })),
    [activas],
  );

  return {
    origen,
    elegirOrigen,
    clases,
    activas,
    sinElegir,
    seleccionadas,
    problemas,
    validas: Object.keys(problemas).length === 0,
    alternar,
    quitarClase,
    fijarDuracion,
    fijarPrecio,
    fijarCupo,
    alternarDia,
    fijarHora,
    agregarBloque,
    quitarBloque,
    limpiarBloquesVacios,
    personalizada,
    setPersonalizada,
    agregarPersonalizada,
    llenas: activas.length >= MAX_TIPOS_EVENTO,
  };
}

export type ClasesState = ReturnType<typeof useClases>;
