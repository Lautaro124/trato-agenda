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

/** Lo que el usuario tipeó en la capacidad → entero, o `undefined` si quedó vacío. */
export function leerCapacidad(texto: string): number | undefined {
  const digitos = texto.replace(/\D/g, "").slice(0, 3);
  return digitos === "" ? undefined : Number(digitos);
}

function minutos(hora: string): number {
  const [horas, mins] = hora.split(":").map(Number);
  return horas * 60 + mins;
}

/** Un entero de `CAPACIDAD_MIN` a `CAPACIDAD_MAX`. */
export function capacidadValida(capacidad: number | undefined): capacidad is number {
  return capacidad !== undefined && Number.isInteger(capacidad) && capacidad >= CAPACIDAD_MIN && capacidad <= CAPACIDAD_MAX;
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
  if (!capacidadValida(capacidad)) {
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

/**
 * En pantalla los horarios se cargan como "estos días a esta hora": un bloque
 * de días con una sola hora, y tantos bloques como hagan falta (sábados a otra
 * hora). Al guardar, cada día de cada bloque es un horario.
 */
export type BloqueClase = { dias: DiaSemana[]; hora: string };

/** Los horarios de unos bloques: uno por día. */
export function horariosDeBloques(bloques: BloqueClase[]): HorarioGrupal[] {
  return ordenarHorarios(bloques.flatMap((bloque) => bloque.dias.map((dia) => ({ dia, hora: bloque.hora }))));
}

/** Al revés: los horarios guardados agrupados por hora, para volver a mostrarlos como bloques. */
export function bloquesDeHorarios(horarios: HorarioGrupal[]): BloqueClase[] {
  const porHora = new Map<string, DiaSemana[]>();
  for (const { dia, hora } of ordenarHorarios(horarios)) porHora.set(hora, [...(porHora.get(hora) ?? []), dia]);
  return [...porHora.entries()].map(([hora, dias]) => ({ hora, dias }));
}

const ABREVIATURA: Record<DiaSemana, string> = {
  lun: "lun",
  mar: "mar",
  mie: "mié",
  jue: "jue",
  vie: "vie",
  sab: "sáb",
  dom: "dom",
};

function lista(partes: string[]): string {
  return partes.length <= 1 ? partes.join("") : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
}

/** "lun, mié y vie": los días de un bloque en el orden de la semana. */
export function textoDias(bloque: BloqueClase): string {
  return lista(DIAS_SEMANA.filter((dia) => bloque.dias.includes(dia)).map((dia) => ABREVIATURA[dia]));
}

/** "lun, mié y vie 18:00 · sáb 10:00". */
export function textoBloques(bloques: BloqueClase[]): string {
  return bloques
    .filter((bloque) => bloque.dias.length > 0)
    .map((bloque) => `${textoDias(bloque)} ${bloque.hora}`)
    .join(" · ");
}

/** "19:00": a qué hora termina una clase que empieza a `hora` y dura `duracionMin`. */
export function horaDeFin(hora: string, duracionMin: number): string {
  const fin = (minutos(hora) + duracionMin) % (24 * 60);
  return `${String(Math.floor(fin / 60)).padStart(2, "0")}:${String(fin % 60).padStart(2, "0")}`;
}

/** Como `problemaGrupal`, pero sobre bloques: uno sin días todavía no se puede guardar. */
export function problemaDeBloques(
  duracionMin: number,
  capacidad: number | undefined,
  bloques: BloqueClase[],
): string | null {
  if (capacidad !== undefined && bloques.some((bloque) => bloque.dias.length === 0)) return "Elegí al menos un día.";
  return problemaGrupal(duracionMin, capacidad, horariosDeBloques(bloques));
}
