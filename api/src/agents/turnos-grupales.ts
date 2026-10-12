/**
 * Turnos grupales (LAU-13): un tipo de turno al que se anotan varias personas
 * en el mismo horario, hasta su capacidad. Los horarios los fija el dueño
 * (días y horas de la semana, p. ej. lunes y miércoles 18:00) y los clientes
 * sólo se pueden anotar ahí.
 *
 * Viven dentro de cada elemento de `Agent.tiposEvento` (Json), como `precio`:
 * sin migración. Un tipo es grupal cuando tiene `capacidad`, y entonces tiene
 * al menos un horario. Todo acá es puro, igual que local.ts.
 */
import { DIAS_SEMANA, NOMBRE_DIA, type DiaSemana } from './local.js';

export const CAPACIDAD_MIN = 1;
export const CAPACIDAD_MAX = 100;
/** Dos por día alcanzan para mañana y tarde. */
export const MAX_HORARIOS_GRUPALES = 14;

/** "HH:MM" en formato 24hs, igual que la franja de la agenda. */
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTOS_DEL_DIA = 24 * 60;

export type HorarioGrupal = { dia: DiaSemana; hora: string };

export type DatosGrupales = { capacidad: number; horarios: HorarioGrupal[] };

/** Lo que llega del DTO (o de la fila), antes de normalizar. */
export type TipoEventoEntrada = {
  nombre: string;
  duracionMin: number;
  precio?: number;
  capacidad?: number;
  horarios?: HorarioGrupal[];
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esDia(valor: unknown): valor is DiaSemana {
  return typeof valor === 'string' && (DIAS_SEMANA as readonly string[]).includes(valor);
}

function esCapacidad(valor: unknown): valor is number {
  return Number.isInteger(valor) && (valor as number) >= CAPACIDAD_MIN && (valor as number) <= CAPACIDAD_MAX;
}

export function minutosDeHora(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

/** Ordenados por día de la semana y, dentro del día, por hora; sin repetidos. */
function ordenarHorarios(horarios: HorarioGrupal[]): HorarioGrupal[] {
  const unicos = new Map(horarios.map((horario) => [`${horario.dia} ${horario.hora}`, horario]));
  return [...unicos.values()].sort(
    (a, b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia) || a.hora.localeCompare(b.hora),
  );
}

/** Por qué los horarios (ya ordenados) de un tipo no se pueden guardar, o null. */
function problemaDeHorarios(nombre: string, duracionMin: number, horarios: HorarioGrupal[]): string | null {
  if (horarios.length > MAX_HORARIOS_GRUPALES) return `"${nombre}" tiene demasiados horarios.`;
  for (const [indice, horario] of horarios.entries()) {
    if (!esDia(horario.dia) || !HORA_HHMM.test(horario.hora)) {
      return `"${nombre}" tiene un horario con un formato inválido.`;
    }
    if (minutosDeHora(horario.hora) + duracionMin > MINUTOS_DEL_DIA) {
      return `"${nombre}" del ${NOMBRE_DIA[horario.dia]} a las ${horario.hora} termina pasada la medianoche.`;
    }
    const anterior = horarios[indice - 1];
    if (anterior?.dia === horario.dia && minutosDeHora(anterior.hora) + duracionMin > minutosDeHora(horario.hora)) {
      return `Los horarios de "${nombre}" del ${NOMBRE_DIA[horario.dia]} se pisan.`;
    }
  }
  return null;
}

/**
 * Valida y normaliza un tipo de turno de la pantalla. Devuelve el motivo del
 * rechazo en castellano (va tal cual en el 400). Los horarios sin capacidad o
 * la capacidad sin horarios son un error, no se completan: el dueño tiene que
 * ver qué quedó guardado.
 */
export function normalizarTipoEvento(
  tipo: TipoEventoEntrada,
): { tipo: TipoEventoEntrada } | { error: string } {
  const nombre = tipo.nombre.trim();
  const base: TipoEventoEntrada = {
    nombre,
    duracionMin: tipo.duracionMin,
    ...(tipo.precio !== undefined ? { precio: tipo.precio } : {}),
  };
  const horarios = ordenarHorarios(tipo.horarios ?? []);
  if (tipo.capacidad === undefined) {
    if (horarios.length > 0) return { error: `"${nombre}" tiene horarios pero no cuántas personas entran.` };
    return { tipo: base };
  }
  if (!esCapacidad(tipo.capacidad)) {
    return { error: `La capacidad de "${nombre}" tiene que ser un número entero de ${CAPACIDAD_MIN} a ${CAPACIDAD_MAX}.` };
  }
  if (horarios.length === 0) return { error: `Poné al menos un horario para "${nombre}".` };
  const problema = problemaDeHorarios(nombre, tipo.duracionMin, horarios);
  if (problema) return { error: problema };
  return { tipo: { ...base, capacidad: tipo.capacidad, horarios } };
}

/** Normaliza la lista entera; el primer error corta. */
export function normalizarTiposEvento(
  tipos: TipoEventoEntrada[],
): { tipos: TipoEventoEntrada[] } | { error: string } {
  const normalizados: TipoEventoEntrada[] = [];
  for (const tipo of tipos) {
    const resultado = normalizarTipoEvento(tipo);
    if ('error' in resultado) return resultado;
    normalizados.push(resultado.tipo);
  }
  return { tipos: normalizados };
}

/**
 * Lee la parte grupal de un elemento de `Agent.tiposEvento` (Json). Si algo no
 * tiene la forma esperada el tipo se trata como individual: nunca se inventa
 * una capacidad ni un horario.
 */
export function leerGrupal(item: Record<string, unknown>, duracionMin: number): DatosGrupales | null {
  const { capacidad, horarios } = item;
  if (!esCapacidad(capacidad) || !Array.isArray(horarios)) return null;
  const leidos = horarios.flatMap((horario): HorarioGrupal[] =>
    esObjeto(horario) && esDia(horario.dia) && typeof horario.hora === 'string' && HORA_HHMM.test(horario.hora)
      ? [{ dia: horario.dia, hora: horario.hora }]
      : [],
  );
  const ordenados = ordenarHorarios(leidos);
  if (ordenados.length === 0 || problemaDeHorarios('', duracionMin, ordenados)) return null;
  return { capacidad, horarios: ordenados };
}

export function esGrupal<T extends { capacidad?: number; horarios?: HorarioGrupal[] }>(
  tipo: T,
): tipo is T & DatosGrupales {
  return tipo.capacidad !== undefined && (tipo.horarios?.length ?? 0) > 0;
}

/** "lunes 18:00 y 20:00; miércoles 18:00". */
export function resumenHorariosGrupales(horarios: HorarioGrupal[]): string {
  return DIAS_SEMANA.flatMap((dia) => {
    const horas = horarios.filter((horario) => horario.dia === dia).map((horario) => horario.hora);
    if (horas.length === 0) return [];
    const lista = horas.length === 1 ? horas[0] : `${horas.slice(0, -1).join(', ')} y ${horas.at(-1)}`;
    return [`${NOMBRE_DIA[dia]} ${lista}`];
  }).join('; ');
}

/** "grupal de hasta 10 personas: lunes 18:00; miércoles 18:00". */
export function detalleGrupal(datos: DatosGrupales): string {
  const personas = datos.capacidad === 1 ? '1 persona' : `${datos.capacidad} personas`;
  return `grupal de hasta ${personas}: ${resumenHorariosGrupales(datos.horarios)}`;
}

/**
 * Título del evento compartido de una clase: "Yoga (grupal) · 3/10". Sin
 * nombres de clientes (con muchos anotados no entran); el dueño los ve con
 * listar_turnos. Sin capacidad (el tipo dejó de ser grupal) va sólo la cuenta.
 */
export function tituloEventoGrupal(tipo: string, anotados: number, capacidad?: number): string {
  return `${tipo} (grupal) · ${capacidad === undefined ? `${anotados} anotados` : `${anotados}/${capacidad}`}`;
}
