/**
 * Turnos grupales del lado de la pantalla: un tipo de turno al que se anotan
 * varias personas en sus horarios fijos, hasta su capacidad. Copia a mano de
 * las reglas de api/src/agents/turnos-grupales.ts (si no coinciden, la API
 * responde 400 con el motivo).
 */
import { DIAS_SEMANA, NOMBRE_DIA, type DiaSemana } from "@/lib/local";

export const CAPACIDAD_MIN = 1;
export const CAPACIDAD_MAX = 100;
export const MAX_HORARIOS_GRUPALES = 14;

export type HorarioGrupal = { dia: DiaSemana; hora: string };

/** El horario que se agrega por defecto: el día siguiente al último cargado, a la misma hora. */
export function horarioSiguiente(horarios: HorarioGrupal[]): HorarioGrupal {
  const ultimo = horarios.at(-1);
  if (!ultimo) return { dia: "lun", hora: "18:00" };
  const siguiente = DIAS_SEMANA[(DIAS_SEMANA.indexOf(ultimo.dia) + 1) % DIAS_SEMANA.length];
  return { dia: siguiente, hora: ultimo.hora };
}

/** Cada 15 minutos, de 06:00 a 23:45. */
export const HORAS_GRUPALES = Array.from({ length: 72 }, (_, i) => {
  const minutos = 6 * 60 + i * 15;
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
});

/** Lo que el usuario tipeó en la capacidad → entero, o `undefined` si quedó vacío. */
export function leerCapacidad(texto: string): number | undefined {
  const digitos = texto.replace(/\D/g, "").slice(0, 3);
  return digitos === "" ? undefined : Number(digitos);
}

function minutos(hora: string): number {
  const [horas, mins] = hora.split(":").map(Number);
  return horas * 60 + mins;
}

/** Ordenados por día de la semana y por hora, como los guarda la API. */
export function ordenarHorarios(horarios: HorarioGrupal[]): HorarioGrupal[] {
  return [...horarios].sort(
    (a, b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia) || a.hora.localeCompare(b.hora),
  );
}

/** Por qué un turno grupal no se puede guardar todavía, o null si está bien. */
export function problemaGrupal(
  duracionMin: number,
  capacidad: number | undefined,
  horarios: HorarioGrupal[],
): string | null {
  if (capacidad === undefined || !Number.isInteger(capacidad) || capacidad < CAPACIDAD_MIN || capacidad > CAPACIDAD_MAX) {
    return `Poné cuántas personas entran: un número entero de ${CAPACIDAD_MIN} a ${CAPACIDAD_MAX}.`;
  }
  if (horarios.length === 0) return "Agregá al menos un horario.";
  const ordenados = ordenarHorarios(horarios);
  for (const [indice, horario] of ordenados.entries()) {
    if (minutos(horario.hora) + duracionMin > 24 * 60) {
      return `La del ${NOMBRE_DIA[horario.dia].toLowerCase()} a las ${horario.hora} termina pasada la medianoche.`;
    }
    const anterior = ordenados[indice - 1];
    if (anterior?.dia === horario.dia && anterior.hora === horario.hora) {
      return `El ${NOMBRE_DIA[horario.dia].toLowerCase()} a las ${horario.hora} está repetido.`;
    }
    if (anterior?.dia === horario.dia && minutos(anterior.hora) + duracionMin > minutos(horario.hora)) {
      return `Los horarios del ${NOMBRE_DIA[horario.dia].toLowerCase()} se pisan: cada uno dura ${duracionMin} min.`;
    }
  }
  return null;
}
