/**
 * De los eventos de Google Calendar a períodos ocupados, en funciones puras.
 * Reemplaza a `freebusy.query`, que necesitaba el scope `calendar.freebusy`:
 * ahora la disponibilidad sale de `events.list` (cubierto por
 * `calendar.events`), y lo que freebusy decidía del lado de Google — qué
 * evento bloquea y cuál no — se decide acá.
 */
import type { calendar_v3 } from 'googleapis';
import type { PeriodoOcupado } from './calendar.service.js';

/**
 * Sólo los campos que hacen falta para decidir si un evento ocupa y cuándo.
 * Va como `fields` en `events.list`: además de ahorrar bytes, es la
 * minimización de datos que promete `docs/verificacion-google.md` — nunca se
 * piden título, descripción, ubicación ni emails de invitados.
 */
export const CAMPOS_OCUPADOS =
  'nextPageToken,timeZone,items(status,transparency,eventType,start,end,attendees(self,responseStatus))';

/** "2026-09-14": la forma de `start.date` / `end.date` en un evento de día completo. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateadorDe(zona: string): Intl.DateTimeFormat {
  let formateador = formateadores.get(zona);
  if (!formateador) {
    formateador = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formateadores.set(zona, formateador);
  }
  return formateador;
}

/** true si Intl reconoce la zona IANA (Google la manda en `timeZone`). */
export function esZonaValida(zona: string | null | undefined): zona is string {
  if (!zona) return false;
  try {
    formateadorDe(zona);
    return true;
  } catch {
    return false;
  }
}

/** Cuántos ms está la hora local de `zona` por delante de UTC en ese instante. */
function desfaseMs(instante: number, zona: string): number {
  const partes = formateadorDe(zona).formatToParts(new Date(instante));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((parte) => parte.type === tipo)?.value);
  const comoUtc = Date.UTC(
    valor('year'),
    valor('month') - 1,
    valor('day'),
    valor('hour'),
    valor('minute'),
    valor('second'),
  );
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/**
 * La medianoche de una fecha "YYYY-MM-DD" en una zona IANA, como instante.
 * Dos pasadas: la primera estima con el desfase de la medianoche UTC, la
 * segunda corrige si entre las dos cae un cambio de horario. Sirve para
 * cualquier zona, no sólo para el -03:00 fijo de Argentina, porque la zona es
 * la del calendario del titular.
 */
export function medianocheEnZona(fecha: string, zona: string): Date | null {
  const partes = SOLO_FECHA.exec(fecha);
  if (!partes) return null;
  const base = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  const estimado = base - desfaseMs(base, zona);
  return new Date(base - desfaseMs(estimado, zona));
}

function instanteDe(momento: calendar_v3.Schema$EventDateTime | undefined, zona: string): Date | null {
  if (momento?.dateTime) {
    // Google manda dateTime siempre con offset (RFC 3339).
    const fecha = new Date(momento.dateTime);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }
  // Día completo: `end.date` es exclusivo, así que su medianoche ya es el fin.
  if (momento?.date) return medianocheEnZona(momento.date, zona);
  return null;
}

/**
 * true si el evento bloquea la agenda. Los mismos criterios que aplicaba
 * freebusy: no cuentan los cancelados, los marcados "Disponible"
 * (`transparency: transparent`) ni las invitaciones que el titular rechazó.
 * Tampoco los de ubicación de trabajo ("Trabajo desde casa"), que son de día
 * completo y bloquearían el día entero aunque freebusy nunca los contó.
 */
export function bloqueaAgenda(evento: calendar_v3.Schema$Event): boolean {
  if (evento.status === 'cancelled') return false;
  if (evento.transparency === 'transparent') return false;
  if (evento.eventType === 'workingLocation') return false;
  const rechazada = evento.attendees?.some(
    (invitado) => invitado.self === true && invitado.responseStatus === 'declined',
  );
  return !rechazada;
}

/**
 * Los períodos ocupados de una lista de eventos (ya expandidos con
 * `singleEvents: true`, así cada instancia de un recurrente llega por
 * separado). `zona` es la del calendario (`timeZone` de la respuesta) y sólo
 * importa para los eventos de día completo; si falta o no es válida se usa
 * `zonaPorDefecto`. No se funden los solapados: freebusy tampoco garantizaba
 * eso y las reglas de agenda trabajan con períodos superpuestos.
 */
export function ocupadosDeEventos(
  eventos: calendar_v3.Schema$Event[],
  zona: string | null | undefined,
  zonaPorDefecto: string,
): PeriodoOcupado[] {
  const zonaEfectiva = esZonaValida(zona) ? zona : zonaPorDefecto;
  const ocupados: PeriodoOcupado[] = [];
  for (const evento of eventos) {
    if (!bloqueaAgenda(evento)) continue;
    const inicio = instanteDe(evento.start, zonaEfectiva);
    const fin = instanteDe(evento.end, zonaEfectiva);
    if (!inicio || !fin || fin.getTime() <= inicio.getTime()) continue;
    ocupados.push({ inicio, fin });
  }
  return ocupados.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}
