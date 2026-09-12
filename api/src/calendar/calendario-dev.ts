import { randomUUID } from 'node:crypto';
import type { DatosEvento, EventoListado, PeriodoOcupado } from './calendar.service.js';
import { CalendarUnavailableError } from './google-calendar.client.js';

type EventoDev = { id: string; resumen: string; inicio: Date; fin: Date };

function seSuperpone(evento: EventoDev, desde: Date, hasta: Date): boolean {
  return evento.inicio < hasta && evento.fin > desde;
}

function porInicio(a: EventoDev, b: EventoDev): number {
  return a.inicio.getTime() - b.inicio.getTime();
}

/**
 * Calendario falso para los usuarios del login de desarrollo, que no tienen
 * Google Calendar. Imita lo que el resto del código usa de la API de Google
 * (freeBusy, insert, delete, patch, list), así el grafo conversacional, el
 * banco de pruebas del Home y /calendario funcionan igual que con un usuario
 * real.
 *
 * Vive en memoria a propósito: no hace falta una tabla que después viaje a
 * producción. Un reinicio de la API lo vacía; los `Turno` confirmados siguen
 * en la base y `unirOcupados` los sigue contando como ocupados.
 */
export class CalendarioDev {
  private readonly porUsuario = new Map<string, Map<string, EventoDev>>();

  private eventos(userId: string): Map<string, EventoDev> {
    let eventos = this.porUsuario.get(userId);
    if (!eventos) {
      eventos = new Map();
      this.porUsuario.set(userId, eventos);
    }
    return eventos;
  }

  private buscar(userId: string, eventId: string): EventoDev {
    const evento = this.eventos(userId).get(eventId);
    if (!evento) {
      // Google contesta 404 y CalendarService lo traduce a este mismo error.
      throw new CalendarUnavailableError(`El evento ${eventId} no existe en el calendario de desarrollo.`);
    }
    return evento;
  }

  freeBusy(userId: string, desde: Date, hasta: Date): PeriodoOcupado[] {
    return [...this.eventos(userId).values()]
      .filter((evento) => seSuperpone(evento, desde, hasta))
      .sort(porInicio)
      .map((evento) => ({ inicio: new Date(evento.inicio), fin: new Date(evento.fin) }));
  }

  crear(userId: string, datos: DatosEvento): string {
    const id = `dev-evento-${randomUUID()}`;
    this.eventos(userId).set(id, {
      id,
      resumen: datos.resumen,
      inicio: new Date(datos.inicio),
      fin: new Date(datos.fin),
    });
    return id;
  }

  cancelar(userId: string, eventId: string): void {
    this.buscar(userId, eventId);
    this.eventos(userId).delete(eventId);
  }

  reprogramar(
    userId: string,
    eventId: string,
    datos: Partial<Pick<DatosEvento, 'resumen' | 'inicio' | 'fin'>>,
  ): void {
    const evento = this.buscar(userId, eventId);
    this.eventos(userId).set(eventId, {
      ...evento,
      ...(datos.resumen !== undefined ? { resumen: datos.resumen } : {}),
      ...(datos.inicio ? { inicio: new Date(datos.inicio) } : {}),
      ...(datos.fin ? { fin: new Date(datos.fin) } : {}),
    });
  }

  listar(userId: string, desde: Date, hasta: Date): EventoListado[] {
    return [...this.eventos(userId).values()]
      .filter((evento) => seSuperpone(evento, desde, hasta))
      .sort(porInicio)
      .map((evento) => ({
        id: evento.id,
        resumen: evento.resumen,
        inicio: new Date(evento.inicio),
        fin: new Date(evento.fin),
      }));
  }
}
