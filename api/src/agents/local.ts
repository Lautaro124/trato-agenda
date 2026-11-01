/**
 * El lugar físico donde se atiende, en `Agent.local` (Json). Los dos
 * asistentes lo usan, cada uno con su forma:
 * - ventas: el local a la calle de un comercio — si tiene, dónde queda, cuándo
 *   abre y si se puede retirar ahí.
 * - agenda (LAU-17): dónde se dan los turnos — un local o consultorio, la casa
 *   del titular, o ningún lugar fijo (`tieneLocal: false`: online o a
 *   domicilio). Sin horarios ni retiro: cuándo atiende ya lo dicen la franja y
 *   las clases, y la dirección es obligatoria (es todo lo que hay para cargar).
 * Los grafos lo leen en cada mensaje, así que guardarlo no regenera el system
 * prompt.
 *
 * Todo acá es puro (sin base ni red), igual que mensajes.rules.ts: lo usan el
 * endpoint que lo guarda y el bloque del prompt que se lo cuenta al modelo.
 */
import type { Agent } from '../generated/prisma/client.js';
import type { TipoAsistente } from './agent-catalog.js';

/** En el orden de la semana argentina: lunes primero. */
export const DIAS_SEMANA = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];

export const NOMBRE_DIA: Record<DiaSemana, string> = {
  lun: 'lunes',
  mar: 'martes',
  mie: 'miércoles',
  jue: 'jueves',
  vie: 'viernes',
  sab: 'sábado',
  dom: 'domingo',
};

/** Dos alcanzan para el corte del mediodía; más ya no se lee en un mensaje. */
export const MAX_FRANJAS_POR_DIA = 2;
export const MAX_FRANJAS = DIAS_SEMANA.length * MAX_FRANJAS_POR_DIA;
export const LARGO_MIN_DIRECCION = 3;
export const LARGO_MAX_DIRECCION = 200;
export const LARGO_MAX_ENLACE = 500;

/** "HH:MM" en formato 24hs, igual que la franja de la agenda. */
const HORA_HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type FranjaLocal = { dia: DiaSemana; desde: string; hasta: string };

/** Sólo agenda: dónde da los turnos quien tiene un lugar fijo. */
export const TIPOS_LUGAR = ['local', 'casa'] as const;
export type TipoLugar = (typeof TIPOS_LUGAR)[number];

export type LocalPresencial = {
  tieneLocal: boolean;
  /** Sólo agenda y con `tieneLocal`: si es un local o consultorio, o su casa. */
  lugar?: TipoLugar;
  direccion?: string;
  /** Link de Google Maps (o el que sea), siempre https. */
  enlaceUbicacion?: string;
  horarios: FranjaLocal[];
  retiroEnLocal: boolean;
};

/** Lo que manda la pantalla, ya con la forma validada por el DTO. */
export type LocalEntrada = {
  tieneLocal: boolean;
  lugar?: TipoLugar;
  direccion?: string;
  enlaceUbicacion?: string;
  horarios?: FranjaLocal[];
  retiroEnLocal?: boolean;
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esLugar(valor: unknown): valor is TipoLugar {
  return typeof valor === 'string' && (TIPOS_LUGAR as readonly string[]).includes(valor);
}

export function esDia(valor: unknown): valor is DiaSemana {
  return typeof valor === 'string' && (DIAS_SEMANA as readonly string[]).includes(valor);
}

/** Un texto del dueño en una sola línea: un salto de línea en el prompt se lee como otra regla. */
function enUnaLinea(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

function esHttps(enlace: string): boolean {
  try {
    return new URL(enlace).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Ordenadas por día de la semana y, dentro del día, por hora. */
export function ordenar(franjas: FranjaLocal[]): FranjaLocal[] {
  return [...franjas].sort(
    (a, b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia) || a.desde.localeCompare(b.desde),
  );
}

/** Por qué la dirección o el enlace no se pueden guardar, o null. */
function problemaDeTextos(direccion: string, enlace: string): string | null {
  if (direccion && direccion.length < LARGO_MIN_DIRECCION) return 'La dirección es demasiado corta.';
  if (direccion.length > LARGO_MAX_DIRECCION) return 'La dirección es demasiado larga.';
  // Sin espacios: `new URL` descarta los saltos de línea, y el link va tal cual al prompt.
  if (enlace && (/\s/.test(enlace) || !esHttps(enlace) || enlace.length > LARGO_MAX_ENLACE)) {
    return 'El enlace de ubicación tiene que ser una dirección https.';
  }
  return null;
}

/**
 * Una franja nocturna termina al día siguiente: "lunes de 19:00 a 07:00" va
 * del lunes a la noche al martes a la mañana. Comparar "HH:MM" como strings
 * alcanza: mismo largo y campos de ancho fijo.
 */
export function cruzaMedianoche(franja: { desde: string; hasta: string }): boolean {
  return franja.hasta < franja.desde;
}

/** Si una franja nocturna se pisa con la mañana del día siguiente (del domingo, el lunes). */
function problemaDeLaNoche(horarios: FranjaLocal[], franja: FranjaLocal): string | null {
  if (!cruzaMedianoche(franja)) return null;
  const siguiente = DIAS_SEMANA[(DIAS_SEMANA.indexOf(franja.dia) + 1) % DIAS_SEMANA.length];
  return franjasDe(horarios, siguiente).some((otra) => otra.desde < franja.hasta)
    ? `El ${NOMBRE_DIA[siguiente]} empieza antes de que termine el horario de la noche anterior.`
    : null;
}

/**
 * Por qué los horarios (ya ordenados) no se pueden guardar, o null. Con
 * `nocturnas`, la última franja de cada día puede cruzar la medianoche (sólo
 * el horario de atención: el local y la agenda cierran el mismo día).
 */
export function problemaDeHorarios(horarios: FranjaLocal[], { nocturnas = false } = {}): string | null {
  if (horarios.length > MAX_FRANJAS) return 'Hay demasiados horarios cargados.';
  for (const [indice, franja] of horarios.entries()) {
    if (!esDia(franja.dia) || !HORA_HHMM.test(franja.desde) || !HORA_HHMM.test(franja.hasta)) {
      return 'Hay un horario con un formato inválido.';
    }
    if (franja.desde === franja.hasta || (cruzaMedianoche(franja) && !nocturnas)) {
      return `El ${NOMBRE_DIA[franja.dia]} cierra antes de abrir.`;
    }
    // Ordenadas por hora, una nocturna que no es la última del día se pisa con la siguiente.
    const anterior = horarios[indice - 1];
    if (anterior?.dia === franja.dia && (cruzaMedianoche(anterior) || anterior.hasta > franja.desde)) {
      return `Los horarios del ${NOMBRE_DIA[franja.dia]} se pisan.`;
    }
    const deLaNoche = problemaDeLaNoche(horarios, franja);
    if (deLaNoche) return deLaNoche;
  }
  const sobrecargado = DIAS_SEMANA.find(
    (dia) => horarios.filter((franja) => franja.dia === dia).length > MAX_FRANJAS_POR_DIA,
  );
  return sobrecargado ? `El ${NOMBRE_DIA[sobrecargado]} tiene más de ${MAX_FRANJAS_POR_DIA} horarios.` : null;
}

/**
 * Valida y normaliza lo que manda la pantalla. Devuelve el motivo del rechazo
 * en castellano (va tal cual en el 400). Sin local no se guarda nada más: una
 * dirección o un retiro sueltos se le contarían al cliente de un negocio que
 * no tiene dónde atenderlo. `tipo` dice de qué asistente es: el de turnos no
 * guarda horarios ni retiro, y sí exige la dirección y el tipo de lugar.
 */
export function normalizarLocal(
  entrada: LocalEntrada,
  tipo: TipoAsistente = 'ventas',
): { local: LocalPresencial } | { error: string } {
  if (!entrada.tieneLocal) {
    return { local: { tieneLocal: false, horarios: [], retiroEnLocal: false } };
  }
  if (tipo === 'agenda') return normalizarLugarDeTurnos(entrada);
  const direccion = enUnaLinea(entrada.direccion ?? '');
  const enlace = (entrada.enlaceUbicacion ?? '').trim();
  const horarios = ordenar(entrada.horarios ?? []);
  const error = problemaDeTextos(direccion, enlace) ?? problemaDeHorarios(horarios);
  if (error) return { error };

  return {
    local: {
      tieneLocal: true,
      ...(direccion ? { direccion } : {}),
      ...(enlace ? { enlaceUbicacion: enlace } : {}),
      horarios: horarios.map(({ dia, desde, hasta }) => ({ dia, desde, hasta })),
      retiroEnLocal: entrada.retiroEnLocal === true,
    },
  };
}

/** El lugar de un asistente de turnos con dirección fija (local o casa). */
function normalizarLugarDeTurnos(entrada: LocalEntrada): { local: LocalPresencial } | { error: string } {
  const direccion = enUnaLinea(entrada.direccion ?? '');
  const enlace = (entrada.enlaceUbicacion ?? '').trim();
  if (!direccion) return { error: 'Falta la dirección.' };
  const error = problemaDeTextos(direccion, enlace);
  if (error) return { error };
  return {
    local: {
      tieneLocal: true,
      lugar: esLugar(entrada.lugar) ? entrada.lugar : 'local',
      direccion,
      ...(enlace ? { enlaceUbicacion: enlace } : {}),
      horarios: [],
      retiroEnLocal: false,
    },
  };
}

/**
 * `Agent.local` es una columna Json: hay que validar la forma antes de usarla
 * en vez de castear. Lo que no se entiende vuelve como `null` (= nunca lo
 * cargó), que es el caso en el que el asistente no afirma nada del local.
 */
export function leerLocal(
  agent: Partial<Pick<Agent, 'local'>>,
  tipo: TipoAsistente = 'ventas',
): LocalPresencial | null {
  const valor = agent.local;
  if (!esObjeto(valor) || typeof valor.tieneLocal !== 'boolean') return null;
  const entrada: LocalEntrada = {
    tieneLocal: valor.tieneLocal,
    lugar: esLugar(valor.lugar) ? valor.lugar : undefined,
    direccion: typeof valor.direccion === 'string' ? valor.direccion : undefined,
    enlaceUbicacion: typeof valor.enlaceUbicacion === 'string' ? valor.enlaceUbicacion : undefined,
    horarios: Array.isArray(valor.horarios)
      ? valor.horarios.flatMap((franja) =>
          esObjeto(franja) && esDia(franja.dia) && typeof franja.desde === 'string' && typeof franja.hasta === 'string'
            ? [{ dia: franja.dia, desde: franja.desde, hasta: franja.hasta }]
            : [],
        )
      : [],
    retiroEnLocal: valor.retiroEnLocal === true,
  };
  const resultado = normalizarLocal(entrada, tipo);
  return 'local' in resultado ? resultado.local : null;
}

function franjasDe(horarios: FranjaLocal[], dia: DiaSemana): FranjaLocal[] {
  return horarios.filter((franja) => franja.dia === dia);
}

function textoDeFranjas(franjas: FranjaLocal[]): string {
  return franjas.map((franja) => `de ${franja.desde} a ${franja.hasta}`).join(' y ');
}

/**
 * Los horarios en una línea, agrupando días seguidos con las mismas franjas:
 * "lunes a viernes de 09:00 a 13:00 y de 16:00 a 20:00; sábado de 09:00 a 13:00".
 * Vacío si no hay ninguno cargado.
 */
export function resumenHorarios(horarios: FranjaLocal[]): string {
  const grupos: Array<{ primero: DiaSemana; ultimo: DiaSemana; texto: string }> = [];
  for (const dia of DIAS_SEMANA) {
    const franjas = franjasDe(horarios, dia);
    if (franjas.length === 0) continue;
    const texto = textoDeFranjas(ordenar(franjas));
    const previo = grupos.at(-1);
    const seguido = previo && DIAS_SEMANA.indexOf(dia) === DIAS_SEMANA.indexOf(previo.ultimo) + 1;
    if (previo && seguido && previo.texto === texto) {
      previo.ultimo = dia;
    } else {
      grupos.push({ primero: dia, ultimo: dia, texto });
    }
  }
  return grupos.map((grupo) => `${diasDelGrupo(grupo.primero, grupo.ultimo)} ${grupo.texto}`).join('; ');
}

/** "lunes", "sábado y domingo", "lunes a viernes". */
function diasDelGrupo(primero: DiaSemana, ultimo: DiaSemana): string {
  if (primero === ultimo) return NOMBRE_DIA[primero];
  const seguidos = DIAS_SEMANA.indexOf(ultimo) - DIAS_SEMANA.indexOf(primero) === 1;
  return `${NOMBRE_DIA[primero]} ${seguidos ? 'y' : 'a'} ${NOMBRE_DIA[ultimo]}`;
}

const DIA_EN_INGLES: Record<string, DiaSemana> = {
  Mon: 'lun',
  Tue: 'mar',
  Wed: 'mie',
  Thu: 'jue',
  Fri: 'vie',
  Sat: 'sab',
  Sun: 'dom',
};

/** Día de la semana y hora "HH:MM" de `ahora` en `zona`. */
export function diaYHora(ahora: Date, zona: string): { dia: DiaSemana; hora: string } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(ahora);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? '';
  return { dia: DIA_EN_INGLES[valor('weekday')], hora: `${valor('hour')}:${valor('minute')}` };
}

export type EstadoLocal =
  | { abierto: true; hasta: string }
  /** `enDias`: 0 = hoy, 1 = mañana, 2 a 7 = ese día de la semana. */
  | { abierto: false; abre: { dia: DiaSemana; desde: string; enDias: number } | null };

/**
 * Si el local está abierto ahora y, si no, cuándo abre. Va resuelto en el
 * prompt para que el modelo no haga cuentas de días y horas.
 */
export function estadoDelLocal(horarios: FranjaLocal[], ahora: Date, zona: string): EstadoLocal {
  const { dia, hora } = diaYHora(ahora, zona);
  const hoy = DIAS_SEMANA.indexOf(dia);
  const ayer = DIAS_SEMANA[(hoy + DIAS_SEMANA.length - 1) % DIAS_SEMANA.length];
  // Una nocturna sigue abierta desde que empieza hasta la medianoche, y al otro día hasta que termina.
  const abierta =
    franjasDe(horarios, dia).find(
      (franja) => franja.desde <= hora && (hora < franja.hasta || cruzaMedianoche(franja)),
    ) ?? franjasDe(horarios, ayer).find((franja) => cruzaMedianoche(franja) && hora < franja.hasta);
  if (abierta) return { abierto: true, hasta: abierta.hasta };

  // De hoy (lo que falta) a dentro de siete días (el mismo día que viene).
  for (let enDias = 0; enDias <= DIAS_SEMANA.length; enDias++) {
    const diaQueViene = DIAS_SEMANA[(hoy + enDias) % DIAS_SEMANA.length];
    const proxima = ordenar(franjasDe(horarios, diaQueViene)).find((franja) => enDias > 0 || franja.desde > hora);
    if (proxima) return { abierto: false, abre: { dia: diaQueViene, desde: proxima.desde, enDias } };
  }
  return { abierto: false, abre: null };
}
