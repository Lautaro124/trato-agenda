/**
 * El local a la calle de un comercio (sólo asistente de ventas): si tiene,
 * dónde queda, cuándo abre y si se puede retirar ahí. Vive en `Agent.local`
 * (Json) y el grafo de ventas lo lee en cada mensaje, así que guardarlo no
 * regenera el system prompt.
 *
 * Todo acá es puro (sin base ni red), igual que mensajes.rules.ts: lo usan el
 * endpoint que lo guarda y el bloque del prompt que se lo cuenta al modelo.
 */
import type { Agent } from '../generated/prisma/client.js';

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

export type LocalPresencial = {
  tieneLocal: boolean;
  direccion?: string;
  /** Link de Google Maps (o el que sea), siempre https. */
  enlaceUbicacion?: string;
  horarios: FranjaLocal[];
  retiroEnLocal: boolean;
};

/** Lo que manda la pantalla, ya con la forma validada por el DTO. */
export type LocalEntrada = {
  tieneLocal: boolean;
  direccion?: string;
  enlaceUbicacion?: string;
  horarios?: FranjaLocal[];
  retiroEnLocal?: boolean;
};

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esDia(valor: unknown): valor is DiaSemana {
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
function ordenar(franjas: FranjaLocal[]): FranjaLocal[] {
  return [...franjas].sort(
    (a, b) => DIAS_SEMANA.indexOf(a.dia) - DIAS_SEMANA.indexOf(b.dia) || a.desde.localeCompare(b.desde),
  );
}

/**
 * Valida y normaliza lo que manda la pantalla. Devuelve el motivo del rechazo
 * en castellano (va tal cual en el 400). Sin local no se guarda nada más: una
 * dirección o un retiro sueltos se le contarían al cliente de un negocio que
 * no tiene dónde atenderlo.
 */
export function normalizarLocal(entrada: LocalEntrada): { local: LocalPresencial } | { error: string } {
  if (!entrada.tieneLocal) {
    return { local: { tieneLocal: false, horarios: [], retiroEnLocal: false } };
  }

  const direccion = enUnaLinea(entrada.direccion ?? '');
  if (direccion && direccion.length < LARGO_MIN_DIRECCION) return { error: 'La dirección es demasiado corta.' };
  if (direccion.length > LARGO_MAX_DIRECCION) return { error: 'La dirección es demasiado larga.' };

  const enlace = (entrada.enlaceUbicacion ?? '').trim();
  if (enlace && (!esHttps(enlace) || enlace.length > LARGO_MAX_ENLACE)) {
    return { error: 'El enlace de ubicación tiene que ser una dirección https.' };
  }

  const horarios = ordenar(entrada.horarios ?? []);
  if (horarios.length > MAX_FRANJAS) return { error: 'Hay demasiados horarios cargados.' };
  for (const [indice, franja] of horarios.entries()) {
    if (!esDia(franja.dia) || !HORA_HHMM.test(franja.desde) || !HORA_HHMM.test(franja.hasta)) {
      return { error: 'Hay un horario con un formato inválido.' };
    }
    // Comparar "HH:MM" como strings alcanza: mismo largo y campos de ancho fijo.
    if (franja.desde >= franja.hasta) {
      return { error: `El ${NOMBRE_DIA[franja.dia]} cierra antes de abrir.` };
    }
    const anterior = horarios[indice - 1];
    if (anterior?.dia === franja.dia && anterior.hasta > franja.desde) {
      return { error: `Los horarios del ${NOMBRE_DIA[franja.dia]} se pisan.` };
    }
  }
  for (const dia of DIAS_SEMANA) {
    if (horarios.filter((franja) => franja.dia === dia).length > MAX_FRANJAS_POR_DIA) {
      return { error: `El ${NOMBRE_DIA[dia]} tiene más de ${MAX_FRANJAS_POR_DIA} horarios.` };
    }
  }

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

/**
 * `Agent.local` es una columna Json: hay que validar la forma antes de usarla
 * en vez de castear. Lo que no se entiende vuelve como `null` (= nunca lo
 * cargó), que es el caso en el que el asistente no afirma nada del local.
 */
export function leerLocal(agent: Partial<Pick<Agent, 'local'>>): LocalPresencial | null {
  const valor = agent.local;
  if (!esObjeto(valor) || typeof valor.tieneLocal !== 'boolean') return null;
  const entrada: LocalEntrada = {
    tieneLocal: valor.tieneLocal,
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
  const resultado = normalizarLocal(entrada);
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
  return grupos
    .map((grupo) => {
      const dias =
        grupo.primero === grupo.ultimo
          ? NOMBRE_DIA[grupo.primero]
          : DIAS_SEMANA.indexOf(grupo.ultimo) - DIAS_SEMANA.indexOf(grupo.primero) === 1
            ? `${NOMBRE_DIA[grupo.primero]} y ${NOMBRE_DIA[grupo.ultimo]}`
            : `${NOMBRE_DIA[grupo.primero]} a ${NOMBRE_DIA[grupo.ultimo]}`;
      return `${dias} ${grupo.texto}`;
    })
    .join('; ');
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
  const abierta = franjasDe(horarios, dia).find((franja) => franja.desde <= hora && hora < franja.hasta);
  if (abierta) return { abierto: true, hasta: abierta.hasta };

  // De hoy (lo que falta) a dentro de siete días (el mismo día que viene).
  for (let enDias = 0; enDias <= DIAS_SEMANA.length; enDias++) {
    const diaQueViene = DIAS_SEMANA[(hoy + enDias) % DIAS_SEMANA.length];
    const proxima = ordenar(franjasDe(horarios, diaQueViene)).find((franja) => enDias > 0 || franja.desde > hora);
    if (proxima) return { abierto: false, abre: { dia: diaQueViene, desde: proxima.desde, enDias } };
  }
  return { abierto: false, abre: null };
}
