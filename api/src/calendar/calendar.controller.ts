import { BadGatewayException, Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { CalendarService, type EventoListado } from './calendar.service.js';
import { CalendarUnavailableError } from './google-calendar.client.js';

/** Buenos Aires es UTC-3 fijo (sin horario de verano), igual que asume calendar.service.ts. */
const OFFSET_BUENOS_AIRES = '-03:00';
const UN_DIA_MS = 24 * 60 * 60 * 1000;
const SIETE_DIAS_MS = 7 * UN_DIA_MS;

export type ResumenAgenda = { hoy: EventoListado[]; semanaCount: number };

function inicioDeHoyEnBuenosAires(): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(
    new Date(),
  );
  return new Date(`${ymd}T00:00:00${OFFSET_BUENOS_AIRES}`);
}

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  /** Resumen para el Home: eventos de hoy y cuántos hay en los próximos 7 días. */
  @Get('resumen')
  async resumen(@CurrentUser() user: User): Promise<ResumenAgenda> {
    const inicioHoy = inicioDeHoyEnBuenosAires();
    const finHoy = new Date(inicioHoy.getTime() + UN_DIA_MS);
    const finSemana = new Date(inicioHoy.getTime() + SIETE_DIAS_MS);

    try {
      const [hoy, semana] = await Promise.all([
        this.calendarService.listarProximos(user, inicioHoy, finHoy),
        this.calendarService.listarProximos(user, inicioHoy, finSemana),
      ]);
      return { hoy, semanaCount: semana.length };
    } catch (error) {
      if (error instanceof CalendarUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }
}
