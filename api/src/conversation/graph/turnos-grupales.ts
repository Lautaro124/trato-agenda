/**
 * Turnos grupales en el grafo de agenda (LAU-13), en funciones puras. Una
 * "clase" es una ocurrencia concreta de un horario fijo de un tipo grupal
 * (Yoga, el lunes 13/10 a las 18:00). Las clases salen de la fila `Agent`,
 * no de Google: existen aunque todavía no se haya anotado nadie, y por eso
 * también bloquean la agenda para los turnos individuales.
 *
 * Los anotados salen de la tabla `Turno` (las filas con `tipo`): cuántos hay
 * en cada clase y qué conversaciones. Al modelo sólo le llega la cuenta,
 * nunca los nombres: el prompt de un cliente no lleva datos de terceros.
 */
import type { DiaSemana } from '../../agents/local.js';
import { esGrupal, type HorarioGrupal } from '../../agents/turnos-grupales.js';
import type { PeriodoOcupado } from '../../calendar/calendar.service.js';
import { TIMEZONE, claveDia, fechaEnDia, formatearFecha, horaLocal } from './agenda-rules.js';

/** Lo que hace falta de un tipo de turno (`TipoEvento`) para armar sus clases. */
export type TipoConHorarios = {
  nombre: string;
  duracionMin: number;
  capacidad?: number;
  horarios?: HorarioGrupal[];
};

export type Clase = { tipo: string; capacidad: number; inicio: Date; fin: Date };

/** Lo que hay anotado en una clase, por `claveClase`. */
export type AnotadosClase = { cantidad: number; conversaciones: Set<string> };
export type AnotadosPorClase = Map<string, AnotadosClase>;

/** Las clases de la ventana y sus anotados: lo que `cargar_contexto` deja para el resto del grafo. */
export type TurnosGrupales = { clases: Clase[]; anotados: AnotadosPorClase };

/** Cuántas clases por tipo entran en el prompt; el resto se ofrece cuando éstas se llenan o pasan. */
export const MAX_CLASES_EN_PROMPT = 6;
/** Cuántas clases con lugar se sugieren al rechazar una inscripción. */
const MAX_SUGERENCIAS = 3;

/** `Date#getUTCDay` del mediodía local (0 = domingo) → día de la semana. */
const DIA_POR_NUMERO: DiaSemana[] = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

/** "lunes 13/10", igual que los encabezados del resumen de disponibilidad. */
const formateadorDia = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'numeric',
});

/** "lunes 13/10 18:00": corto, para las listas del prompt. */
function etiquetaClase(inicio: Date): string {
  return `${formateadorDia.format(inicio)} ${horaLocal(inicio)}`;
}

/** Minúsculas, sin tildes y con un solo espacio: así se comparan los nombres de tipo. */
export function normalizarNombre(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El tipo de turno que nombra el `resumen` de una tool call. Primero por
 * nombre exacto (sin tildes ni mayúsculas); si no, el único tipo cuyo nombre
 * aparece entero en el texto ("Clase de yoga" → "Yoga"). Con más de uno
 * posible no adivina.
 */
export function tipoPorNombre<T extends { nombre: string }>(tipos: T[], texto: unknown): T | null {
  if (typeof texto !== 'string') return null;
  const buscado = normalizarNombre(texto);
  if (!buscado) return null;
  const exacto = tipos.find((tipo) => normalizarNombre(tipo.nombre) === buscado);
  if (exacto) return exacto;
  // Palabras enteras: "Yoga" está en "clase de yoga" pero no en "yogurt".
  const enPalabras = (valor: string) => ` ${valor.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const enTexto = enPalabras(buscado);
  const contenidos = tipos.filter((tipo) => {
    const nombre = enPalabras(normalizarNombre(tipo.nombre));
    return nombre.trim().length > 0 && enTexto.includes(nombre);
  });
  return contenidos.length === 1 ? contenidos[0] : null;
}

/** Los tipos grupales de un catálogo. */
export function tiposGrupales<T extends TipoConHorarios>(tipos: T[]): (T & { capacidad: number; horarios: HorarioGrupal[] })[] {
  return tipos.filter(esGrupal);
}

/**
 * Las clases que se solapan con [desde, hasta), ordenadas por inicio (también
 * la que está en curso: sigue ocupando la agenda aunque ya no admita anotados). Los
 * horarios son del dueño, así que valen cualquier día de la semana (las
 * reglas de días hábiles y franja son para los turnos individuales).
 */
export function clasesEnRango(tipos: TipoConHorarios[], desde: Date, hasta: Date): Clase[] {
  const grupales = tiposGrupales(tipos);
  if (grupales.length === 0) return [];
  const clases: Clase[] = [];
  const ultimo = claveDia(hasta);
  for (let dia = claveDia(desde); dia <= ultimo; dia = claveDia(new Date(fechaEnDia(dia, '12:00').getTime() + 86_400_000))) {
    const diaSemana = DIA_POR_NUMERO[fechaEnDia(dia, '12:00').getUTCDay()];
    for (const tipo of grupales) {
      for (const horario of tipo.horarios) {
        if (horario.dia !== diaSemana) continue;
        const inicio = fechaEnDia(dia, horario.hora);
        const fin = new Date(inicio.getTime() + tipo.duracionMin * 60_000);
        if (fin <= desde || inicio >= hasta) continue;
        clases.push({ tipo: tipo.nombre, capacidad: tipo.capacidad, inicio, fin });
      }
    }
  }
  return clases.sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || a.tipo.localeCompare(b.tipo));
}

/** Los rangos de las clases, para sumarlos a los ocupados del snapshot. */
export function ocupadosDeClases(clases: Clase[]): PeriodoOcupado[] {
  return clases.map(({ inicio, fin }) => ({ inicio, fin }));
}

export function claveClase(tipo: string, inicio: Date): string {
  return `${normalizarNombre(tipo)}|${inicio.toISOString()}`;
}

/** Cuenta los anotados de cada clase a partir de los turnos confirmados del dueño. */
export function anotadosPorClase(
  turnos: { tipo: string | null; inicio: Date; conversationId: string }[],
): AnotadosPorClase {
  const anotados: AnotadosPorClase = new Map();
  for (const turno of turnos) {
    if (!turno.tipo) continue;
    const clave = claveClase(turno.tipo, turno.inicio);
    const actual = anotados.get(clave) ?? { cantidad: 0, conversaciones: new Set<string>() };
    actual.cantidad += 1;
    actual.conversaciones.add(turno.conversationId);
    anotados.set(clave, actual);
  }
  return anotados;
}

/** Suma un anotado a una clase sin tocar el mapa original. */
export function conAnotado(anotados: AnotadosPorClase, clase: Clase, conversationId: string): AnotadosPorClase {
  const copia = new Map(anotados);
  const clave = claveClase(clase.tipo, clase.inicio);
  const actual = anotados.get(clave);
  copia.set(clave, {
    cantidad: (actual?.cantidad ?? 0) + 1,
    conversaciones: new Set([...(actual?.conversaciones ?? []), conversationId]),
  });
  return copia;
}

/** Saca un anotado de una clase sin tocar el mapa original. */
export function sinAnotado(
  anotados: AnotadosPorClase,
  tipo: string,
  inicio: Date,
  conversationId: string,
): AnotadosPorClase {
  const clave = claveClase(tipo, inicio);
  const actual = anotados.get(clave);
  if (!actual) return anotados;
  const copia = new Map(anotados);
  const conversaciones = new Set(actual.conversaciones);
  conversaciones.delete(conversationId);
  copia.set(clave, { cantidad: Math.max(actual.cantidad - 1, 0), conversaciones });
  return copia;
}

export function anotadosEn(anotados: AnotadosPorClase, clase: Clase): AnotadosClase {
  return anotados.get(claveClase(clase.tipo, clase.inicio)) ?? { cantidad: 0, conversaciones: new Set() };
}

export function lugaresLibres(anotados: AnotadosPorClase, clase: Clase): number {
  return Math.max(clase.capacidad - anotadosEn(anotados, clase).cantidad, 0);
}

/** La clase de ese tipo que empieza justo en `inicio`, si existe. */
export function claseEn(clases: Clase[], tipo: string, inicio: Date): Clase | null {
  const nombre = normalizarNombre(tipo);
  return (
    clases.find((clase) => normalizarNombre(clase.tipo) === nombre && clase.inicio.getTime() === inicio.getTime()) ??
    null
  );
}

/** Las próximas clases de un tipo con lugar, para ofrecer en vez de la pedida. */
export function proximasConLugar(
  clases: Clase[],
  anotados: AnotadosPorClase,
  tipo: string,
  excepto?: Clase,
  cantidad = MAX_SUGERENCIAS,
): Clase[] {
  const nombre = normalizarNombre(tipo);
  return clases
    .filter((clase) => normalizarNombre(clase.tipo) === nombre && clase !== excepto && lugaresLibres(anotados, clase) > 0)
    .slice(0, cantidad);
}

function detalleLugares(anotados: AnotadosPorClase, clase: Clase): string {
  const libres = lugaresLibres(anotados, clase);
  if (libres === 0) return 'completa';
  return libres === 1 ? `queda 1 lugar de ${clase.capacidad}` : `quedan ${libres} lugares de ${clase.capacidad}`;
}

function detalleAlternativas(anotados: AnotadosPorClase, alternativas: Clase[]): string {
  if (alternativas.length === 0) return ' No hay otra clase con lugar en los próximos días: decíselo y ofrecé avisarle al dueño.';
  const lista = alternativas.map((clase) => `${etiquetaClase(clase.inicio)} (${detalleLugares(anotados, clase)})`);
  return ` Las próximas con lugar: ${lista.join(', ')}.`;
}

export function mensajeClaseCompleta(clase: Clase, anotados: AnotadosPorClase, clases: Clase[]): string {
  return (
    `La clase de ${clase.tipo} del ${formatearFecha(clase.inicio)} está completa ` +
    `(${clase.capacidad} de ${clase.capacidad} lugares).` +
    detalleAlternativas(anotados, proximasConLugar(clases, anotados, clase.tipo, clase))
  );
}

export function mensajeFueraDeHorarioGrupal(
  tipo: TipoConHorarios & { horarios: HorarioGrupal[] },
  anotados: AnotadosPorClase,
  clases: Clase[],
): string {
  return (
    `${tipo.nombre} es un turno grupal y sólo se da en sus horarios fijos; ese no es uno de ellos (o queda fuera ` +
    `de los próximos días que tengo cargados). Usá el inicio exacto de una clase.` +
    detalleAlternativas(anotados, proximasConLugar(clases, anotados, tipo.nombre))
  );
}

/**
 * Lo que ve el modelo: las próximas clases de cada tipo grupal con sus lugares
 * libres. Sólo cantidades, nunca quién está anotado.
 */
export function bloqueTurnosGrupales(grupales: TurnosGrupales): string {
  const porTipo = new Map<string, Clase[]>();
  for (const clase of grupales.clases) {
    const lista = porTipo.get(clase.tipo) ?? [];
    if (lista.length < MAX_CLASES_EN_PROMPT) lista.push(clase);
    porTipo.set(clase.tipo, lista);
  }
  if (porTipo.size === 0) return '';
  const lineas = [...porTipo.entries()].map(
    ([tipo, clases]) =>
      `- ${tipo}: ${clases.map((clase) => `${etiquetaClase(clase.inicio)} (${detalleLugares(grupales.anotados, clase)})`).join(' · ')}`,
  );
  return (
    `Próximas clases de los turnos grupales (para anotar a alguien usá crear_turno con ese tipo y el inicio exacto ` +
    `de la clase; nunca ofrezcas una completa):\n${lineas.join('\n')}`
  );
}

/** Las clases con lugar de un día ("2026-10-13"), para sumarlas a la respuesta de disponibilidad. */
export function clasesDelDia(grupales: TurnosGrupales, dia: string): string {
  const delDia = grupales.clases.filter((clase) => claveDia(clase.inicio) === dia);
  if (delDia.length === 0) return '';
  const lista = delDia.map(
    (clase) => `${clase.tipo} a las ${horaLocal(clase.inicio)} (${detalleLugares(grupales.anotados, clase)})`,
  );
  return ` Ese día también hay clases grupales: ${lista.join(', ')}.`;
}
