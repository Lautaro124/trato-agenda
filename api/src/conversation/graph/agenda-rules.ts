/**
 * Reglas duras de la agenda, en funciones puras. Antes vivían mezcladas con la
 * ejecución de los tools (conversation-tools.ts); ahora las usa el nodo
 * `validacion` del grafo, que decide contra el snapshot de agenda cargado una
 * sola vez por mensaje, sin volver a pegarle a Google.
 */
import type { PeriodoOcupado } from '../../calendar/calendar.service.js';
import type { Agent } from '../../generated/prisma/client.js';

export const TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Argentina no tiene horario de verano desde 2009, así que el offset es fijo.
 * Se usa sólo para construir los límites de la franja de atención de un día
 * ("2026-09-08" + "09:00" → Date); todo lo que se muestra al modelo se
 * formatea con Intl sobre TIMEZONE.
 */
const OFFSET = '-03:00';

/**
 * Colchón mínimo entre un turno y el siguiente. Se aplica ensanchando el rango
 * que se compara contra los períodos ocupados, así el chequeo de superposición
 * y el de margen son la misma operación.
 */
export const MARGEN_MINIMO_MIN = 5;

const formateador = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/** Hora local "HH:MM" en TIMEZONE, comparable contra Agent.horaDesde/horaHasta. */
const formateadorHora = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-09-08" en TIMEZONE — clave de día, no de UTC. */
const formateadorDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "lunes 8/9" — encabezado de cada día en el resumen de agenda. */
const formateadorEtiquetaDia = new Intl.DateTimeFormat('es-AR', {
  timeZone: TIMEZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'numeric',
});

export function formatearFecha(fecha: Date): string {
  return formateador.format(fecha);
}

export function horaLocal(fecha: Date): string {
  // es-AR devuelve "24:00" a la medianoche; normalizarlo a "00:00".
  return formateadorHora.format(fecha).replace(/^24:/, '00:');
}

export function claveDia(fecha: Date): string {
  return formateadorDia.format(fecha);
}

/** Un "HH:MM" de la franja del Agent, sobre un día concreto, como Date. */
export function fechaEnDia(dia: string, hhmm: string): Date {
  return new Date(`${dia}T${hhmm}:00${OFFSET}`);
}

/** El rango del turno más el margen mínimo de cada lado. */
export function conMargen(inicio: Date, fin: Date): [Date, Date] {
  const margenMs = MARGEN_MINIMO_MIN * 60_000;
  return [new Date(inicio.getTime() - margenMs), new Date(fin.getTime() + margenMs)];
}

/**
 * Períodos ocupados que se solapan con el rango pedido. Reemplaza la consulta
 * acotada a freeBusy que antes hacía cada tool: el snapshot ya trae todos los
 * ocupados de la ventana, así que filtrar en memoria alcanza.
 */
export function ocupadosEnRango(
  ocupados: PeriodoOcupado[],
  desde: Date,
  hasta: Date,
): PeriodoOcupado[] {
  return ocupados.filter(
    (periodo) => periodo.inicio.getTime() < hasta.getTime() && periodo.fin.getTime() > desde.getTime(),
  );
}

/**
 * Períodos ocupados que realmente bloquean el horario, descartando el evento
 * del propio turno cuando se está reprogramando: sin esto, mover un turno unos
 * minutos choca contra sí mismo por culpa del margen.
 */
export function conflictos(
  ocupados: PeriodoOcupado[],
  ignorar?: { inicio: Date; fin: Date },
): PeriodoOcupado[] {
  if (!ignorar) return ocupados;
  return ocupados.filter(
    (periodo) =>
      periodo.inicio.getTime() !== ignorar.inicio.getTime() ||
      periodo.fin.getTime() !== ignorar.fin.getTime(),
  );
}

export function detalleOcupados(ocupados: PeriodoOcupado[]): string {
  return ocupados
    .map((periodo) => `${formatearFecha(periodo.inicio)} a ${formatearFecha(periodo.fin)}`)
    .join('; ');
}

export type AgentFranja = Pick<Agent, 'horaDesde' | 'horaHasta'>;

/** true si el turno entero entra en la franja de atención del dueño. */
export function dentroDeFranja(agent: AgentFranja, inicio: Date, fin: Date): boolean {
  const desde = horaLocal(inicio);
  const hasta = horaLocal(fin);
  // Un turno que cruza la medianoche siempre cae fuera de la franja.
  if (hasta <= desde) return false;
  return desde >= agent.horaDesde && hasta <= agent.horaHasta;
}

export function mensajeFueraDeFranja(agent: AgentFranja): string {
  return (
    `Ese horario queda fuera de la franja de atención (de ${agent.horaDesde} a ${agent.horaHasta}). ` +
    'Ofrecé un horario dentro de esa franja.'
  );
}

/** `new Date(valor)` sin fallar silenciosamente en algo tipo "Invalid Date". */
export function parsearFecha(valor: unknown, campo: string): Date {
  if (typeof valor !== 'string') {
    throw new Error(`Falta o es inválido el campo "${campo}" (tiene que ser string ISO 8601).`);
  }
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`El campo "${campo}" no es una fecha ISO 8601 válida: "${valor}".`);
  }
  return fecha;
}

export function parsearFechaOpcional(valor: unknown, campo: string): Date | undefined {
  if (valor === undefined || valor === null) return undefined;
  return parsearFecha(valor, campo);
}

export type Hueco = { inicio: Date; fin: Date };

/**
 * Huecos libres de un día dentro de la franja de atención, ya descontado el
 * margen mínimo alrededor de cada período ocupado. `desde` recorta el día en
 * curso para no ofrecer horarios que ya pasaron.
 */
export function huecosDelDia(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  dia: string,
  desde: Date,
  duracionMinimaMin: number,
): Hueco[] {
  const aperturaDia = fechaEnDia(dia, agent.horaDesde);
  const cierre = fechaEnDia(dia, agent.horaHasta);
  const apertura = aperturaDia.getTime() > desde.getTime() ? aperturaDia : desde;
  if (apertura >= cierre) return [];

  const margenMs = MARGEN_MINIMO_MIN * 60_000;
  const bloqueados = ocupadosEnRango(ocupados, apertura, cierre)
    .map((periodo) => ({
      inicio: new Date(periodo.inicio.getTime() - margenMs),
      fin: new Date(periodo.fin.getTime() + margenMs),
    }))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const huecos: Hueco[] = [];
  let cursor = apertura;
  for (const bloque of bloqueados) {
    if (bloque.inicio > cursor) {
      huecos.push({ inicio: cursor, fin: bloque.inicio < cierre ? bloque.inicio : cierre });
    }
    if (bloque.fin > cursor) cursor = bloque.fin;
    if (cursor >= cierre) break;
  }
  if (cursor < cierre) huecos.push({ inicio: cursor, fin: cierre });

  const minimoMs = duracionMinimaMin * 60_000;
  return huecos.filter((hueco) => hueco.fin.getTime() - hueco.inicio.getTime() >= minimoMs);
}

/**
 * Resumen compacto de la disponibilidad para meter en el system prompt. Es lo
 * que evita que el modelo tenga que gastar una vuelta entera (y una lectura a
 * Google) preguntando "¿está libre el martes?".
 */
export function resumirDisponibilidad(
  agent: AgentFranja,
  ocupados: PeriodoOcupado[],
  desde: Date,
  hasta: Date,
  duracionMinimaMin: number,
  maxDias: number,
): string {
  const lineas: string[] = [];
  const cursor = new Date(desde);

  while (cursor < hasta && lineas.length < maxDias) {
    const dia = claveDia(cursor);
    const huecos = huecosDelDia(agent, ocupados, dia, desde, duracionMinimaMin);
    const etiqueta = formateadorEtiquetaDia.format(cursor);
    lineas.push(
      huecos.length > 0
        ? `${etiqueta}: ${huecos.map((h) => `${horaLocal(h.inicio)}-${horaLocal(h.fin)}`).join(', ')}`
        : `${etiqueta}: sin huecos`,
    );
    // Avanzar al día siguiente parándose al mediodía, para no depender de la hora.
    cursor.setTime(fechaEnDia(dia, '12:00').getTime() + 24 * 60 * 60_000);
  }

  return lineas.join('\n');
}
