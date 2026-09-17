import type { PrismaService } from '../prisma/prisma.service.js';
import type { DatosEvento, EventoListado, PeriodoOcupado } from './calendar.service.js';
import { CalendarUnavailableError } from './google-calendar.client.js';

/**
 * Agenda guardada en la base (tabla `Evento`), para las cuentas con
 * `calendario = "local"`: las creadas sólo con WhatsApp y las del login de
 * desarrollo. Imita lo que el resto del código usa de la API de Google
 * (freeBusy, insert, delete, patch, list), así el grafo conversacional, el
 * banco de pruebas del Home y /calendario funcionan igual que con Google.
 *
 * Toda consulta filtra por `userId`: un id de evento de otro usuario se trata
 * como inexistente, igual que Google contesta 404 fuera del calendario propio.
 */
export class CalendarioLocal {
  constructor(private readonly prisma: PrismaService) {}

  private async buscar(userId: string, eventId: string): Promise<void> {
    const evento = await this.prisma.evento.findFirst({ where: { id: eventId, userId }, select: { id: true } });
    if (!evento) {
      // Google contesta 404 y CalendarService lo traduce a este mismo error.
      throw new CalendarUnavailableError(`El evento ${eventId} no existe en la agenda.`);
    }
  }

  private superpuestos(userId: string, desde: Date, hasta: Date) {
    return this.prisma.evento.findMany({
      where: { userId, inicio: { lt: hasta }, fin: { gt: desde } },
      orderBy: { inicio: 'asc' },
    });
  }

  async freeBusy(userId: string, desde: Date, hasta: Date): Promise<PeriodoOcupado[]> {
    const eventos = await this.superpuestos(userId, desde, hasta);
    return eventos.map((evento) => ({ inicio: evento.inicio, fin: evento.fin }));
  }

  async crear(userId: string, datos: DatosEvento): Promise<string> {
    const evento = await this.prisma.evento.create({
      data: { userId, resumen: datos.resumen, inicio: datos.inicio, fin: datos.fin },
      select: { id: true },
    });
    return evento.id;
  }

  async cancelar(userId: string, eventId: string): Promise<void> {
    await this.buscar(userId, eventId);
    await this.prisma.evento.delete({ where: { id: eventId } });
  }

  async reprogramar(
    userId: string,
    eventId: string,
    datos: Partial<Pick<DatosEvento, 'resumen' | 'inicio' | 'fin'>>,
  ): Promise<void> {
    await this.buscar(userId, eventId);
    await this.prisma.evento.update({
      where: { id: eventId },
      data: {
        ...(datos.resumen !== undefined ? { resumen: datos.resumen } : {}),
        ...(datos.inicio ? { inicio: datos.inicio } : {}),
        ...(datos.fin ? { fin: datos.fin } : {}),
      },
    });
  }

  async listar(userId: string, desde: Date, hasta: Date): Promise<EventoListado[]> {
    const eventos = await this.superpuestos(userId, desde, hasta);
    return eventos.map((evento) => ({
      id: evento.id,
      resumen: evento.resumen,
      inicio: evento.inicio,
      fin: evento.fin,
    }));
  }

  /** Eventos que todavía no terminaron, para copiarlos a Google al conectarlo. */
  async futuros(userId: string, desde: Date): Promise<EventoListado[]> {
    const eventos = await this.prisma.evento.findMany({
      where: { userId, fin: { gt: desde } },
      orderBy: { inicio: 'asc' },
    });
    return eventos.map((evento) => ({ id: evento.id, resumen: evento.resumen, inicio: evento.inicio, fin: evento.fin }));
  }
}
