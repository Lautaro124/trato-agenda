"use client";

import { useCallback, useMemo, useState } from "react";
import { DIAS_SEMANA, type DiaSemana } from "@/lib/local";
import {
  CAPACIDAD_MAX,
  CAPACIDAD_MIN,
  MAX_HORARIOS_GRUPALES,
  ordenarHorarios,
  problemaGrupal,
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
 * un tipo de turno grupal (`TipoEvento` con `capacidad` y `horarios`), pero
 * en pantalla los horarios se cargan como "estos días a esta hora": un bloque
 * de días con una sola hora, y tantos bloques como hagan falta (sábados a
 * otra hora). Al armar el payload cada día de cada bloque es un horario.
 */

export type BloqueClase = { dias: DiaSemana[]; hora: string };

export type Clase = {
  nombre: string;
  duracionMin: number;
  precio?: number;
  /** Cuántas personas entran. Sin elegir todavía: `undefined`. */
  cupo?: number;
  bloques: BloqueClase[];
  activa: boolean;
  /** Si el panel de cupo y días está desplegado (sólo de pantalla). */
  abierta: boolean;
};

/** Ideas para arrancar: las clases más comunes, con su duración típica. */
export const CATALOGO_CLASES: Array<{ nombre: string; duracionMin: number }> = [
  { nombre: "Yoga", duracionMin: 60 },
  { nombre: "Pilates", duracionMin: 45 },
  { nombre: "Funcional", duracionMin: 60 },
  { nombre: "Taller", duracionMin: 90 },
];

/** Los atajos del cupo: tocar uno es más rápido que apretar + ocho veces. */
export const CUPOS_SUGERIDOS = [4, 6, 8, 10, 12];

/** Con qué cupo arranca el − / + si todavía no se eligió ninguno. */
const CUPO_INICIAL = 8;

const ABREVIATURA: Record<DiaSemana, string> = {
  lun: "lun",
  mar: "mar",
  mie: "mié",
  jue: "jue",
  vie: "vie",
  sab: "sáb",
  dom: "dom",
};

function bloqueVacio(hora = "18:00"): BloqueClase {
  return { dias: [], hora };
}

function claseNueva(nombre: string, duracionMin: number, activa: boolean): Clase {
  return { nombre, duracionMin, bloques: [bloqueVacio()], activa, abierta: true };
}

/** Los horarios de un bloque de días: uno por día. */
export function horariosDeClase(clase: Pick<Clase, "bloques">): HorarioGrupal[] {
  return ordenarHorarios(clase.bloques.flatMap((bloque) => bloque.dias.map((dia) => ({ dia, hora: bloque.hora }))));
}

/** Al revés: los horarios guardados agrupados por hora, para volver a mostrarlos como bloques. */
export function bloquesDeHorarios(horarios: HorarioGrupal[]): BloqueClase[] {
  const porHora = new Map<string, DiaSemana[]>();
  for (const { dia, hora } of ordenarHorarios(horarios)) porHora.set(hora, [...(porHora.get(hora) ?? []), dia]);
  const bloques = [...porHora.entries()].map(([hora, dias]) => ({ hora, dias }));
  return bloques.length > 0 ? bloques : [bloqueVacio()];
}

function lista(partes: string[]): string {
  return partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/** "lun, mié y vie 18:00 · sáb 10:00". */
export function textoBloques(bloques: BloqueClase[]): string {
  return bloques
    .filter((bloque) => bloque.dias.length > 0)
    .map((bloque) => {
      const dias = DIAS_SEMANA.filter((dia) => bloque.dias.includes(dia)).map((dia) => ABREVIATURA[dia]);
      return `${lista(dias)} ${bloque.hora}`;
    })
    .join(" · ");
}

/** "8 lugares · lun, mié y vie 18:00 · sáb 10:00": la línea de la clase plegada. */
export function resumenClase(clase: Clase): string {
  const lugares = clase.cupo === 1 ? "1 lugar" : `${clase.cupo} lugares`;
  return `${lugares} · ${textoBloques(clase.bloques)}`;
}

/** Qué le falta a una clase elegida para poder guardarla, o null. */
export function problemaDeClase(clase: Clase): string | null {
  if (clase.cupo === undefined) return "Elegí cuántas personas entran.";
  if (clase.bloques.some((bloque) => bloque.dias.length === 0)) return "Elegí al menos un día.";
  return problemaGrupal(clase.duracionMin, clase.cupo, horariosDeClase(clase));
}

/**
 * El estado de las clases. `inicial` son tipos de turno grupales ya guardados
 * (vuelven elegidos); el catálogo de ideas se suma sin elegir.
 */
export function useClases(inicial: TipoEvento[] = []) {
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
        abierta: false,
      }));
    const ideas = CATALOGO_CLASES.filter(
      (idea) => !guardadas.some((clase) => clase.nombre.toLowerCase() === idea.nombre.toLowerCase()),
    ).map((idea) => claseNueva(idea.nombre, idea.duracionMin, false));
    return [...guardadas, ...ideas];
  });
  const [personalizada, setPersonalizada] = useState("");

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
          // Al elegirla se despliega, así se ve enseguida qué falta cargar.
          return { ...clase, activa: !clase.activa, abierta: !clase.activa ? true : clase.abierta };
        });
      }),
    [],
  );

  const alternarPanel = useCallback(
    (nombre: string) => cambiar(nombre, (clase) => ({ ...clase, abierta: !clase.abierta })),
    [cambiar],
  );

  const fijarDuracion = useCallback(
    (nombre: string, duracionMin: number) => cambiar(nombre, (clase) => ({ ...clase, duracionMin })),
    [cambiar],
  );

  const fijarPrecio = useCallback(
    (nombre: string, precio: number | undefined) => cambiar(nombre, (clase) => ({ ...clase, precio })),
    [cambiar],
  );

  const fijarCupo = useCallback(
    (nombre: string, cupo: number) =>
      cambiar(nombre, (clase) => ({ ...clase, cupo: Math.min(Math.max(cupo, CAPACIDAD_MIN), CAPACIDAD_MAX) })),
    [cambiar],
  );

  const moverCupo = useCallback(
    (nombre: string, sentido: 1 | -1) =>
      cambiar(nombre, (clase) => ({
        ...clase,
        cupo:
          clase.cupo === undefined
            ? CUPO_INICIAL
            : Math.min(Math.max(clase.cupo + sentido, CAPACIDAD_MIN), CAPACIDAD_MAX),
      })),
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

  const agregarBloque = useCallback(
    (nombre: string) =>
      cambiar(nombre, (clase) =>
        horariosDeClase(clase).length >= MAX_HORARIOS_GRUPALES
          ? clase
          : { ...clase, bloques: [...clase.bloques, bloqueVacio("10:00")] },
      ),
    [cambiar],
  );

  const quitarBloque = useCallback(
    (nombre: string, indice: number) =>
      cambiar(nombre, (clase) => ({ ...clase, bloques: clase.bloques.filter((_, i) => i !== indice) })),
    [cambiar],
  );

  const agregarPersonalizada = useCallback(() => {
    const nombre = personalizada.trim().slice(0, LARGO_MAX_NOMBRE_EVENTO);
    if (nombre.length < LARGO_MIN_NOMBRE_EVENTO) return;
    setClases((previas) => {
      const existente = previas.find((clase) => clase.nombre.toLowerCase() === nombre.toLowerCase());
      if (existente) {
        return previas.map((clase) => (clase === existente ? { ...clase, activa: true, abierta: true } : clase));
      }
      if (previas.filter((clase) => clase.activa).length >= MAX_TIPOS_EVENTO) return previas;
      return [...previas, claseNueva(nombre, 60, true)];
    });
    setPersonalizada("");
  }, [personalizada]);

  const activas = useMemo(() => clases.filter((clase) => clase.activa), [clases]);

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
    clases,
    activas,
    seleccionadas,
    problemas,
    validas: Object.keys(problemas).length === 0,
    alternar,
    alternarPanel,
    fijarDuracion,
    fijarPrecio,
    fijarCupo,
    moverCupo,
    alternarDia,
    fijarHora,
    agregarBloque,
    quitarBloque,
    personalizada,
    setPersonalizada,
    agregarPersonalizada,
    llenas: activas.length >= MAX_TIPOS_EVENTO,
  };
}

export type ClasesState = ReturnType<typeof useClases>;
