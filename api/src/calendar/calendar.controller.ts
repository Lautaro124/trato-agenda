import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { CalendarService, type EventoListado } from './calendar.service.js';
import { EditarEventoDto } from './calendar.types.js';
import { CalendarUnavailableError } from './google-calendar.client.js';

/** Buenos Aires es UTC-3 fijo (sin horario de verano), igual que asume calendar.service.ts. */
const OFFSET_BUENOS_AIRES = '-03:00';
const UN_DIA_MS = 24 * 60 * 60 * 1000;
const SIETE_DIAS_MS = 7 * UN_DIA_MS;

export type ResumenAgenda = { hoy: EventoListado[]; semanaCount: number };
export type EventoSemana = EventoListado & { agendadoPorAgente: boolean };
export type EventosAgenda = { eventos: EventoSemana[] };

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

  /** Eventos del calendario en un rango [desde, hasta), marcando qué eventos agendó el agente. */
  @Get('eventos')
  async eventos(
    @CurrentUser() user: User,
    @Query('desde') desdeStr: string,
    @Query('hasta') hastaStr: string,
  ): Promise<EventosAgenda> {
    const desde = new Date(`${desdeStr}T00:00:00${OFFSET_BUENOS_AIRES}`);
    const hasta = new Date(`${hastaStr}T00:00:00${OFFSET_BUENOS_AIRES}`);

    try {
      const [eventos, turnosAgendados] = await Promise.all([
        this.calendarService.listarProximos(user, desde, hasta),
        this.calendarService.listarTurnosAgendados(user.id, desde, hasta),
      ]);
      return {
        eventos: eventos.map((evento) => ({
          ...evento,
          agendadoPorAgente: turnosAgendados.has(evento.id),
        })),
      };
    } catch (error) {
      if (error instanceof CalendarUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  /** Elimina un evento del calendario del dueño autenticado, a mano desde la vista web. */
  @Delete('eventos/:eventId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminarEvento(@CurrentUser() user: User, @Param('eventId') eventId: string): Promise<void> {
    try {
      await this.calendarService.eliminarEventoDesdeAgenda(user, user.id, eventId);
    } catch (error) {
      if (error instanceof CalendarUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  /** Edita horario y/o título de un evento del calendario del dueño autenticado. */
  @Patch('eventos/:eventId')
  async editarEvento(
    @CurrentUser() user: User,
    @Param('eventId') eventId: string,
    @Body() dto: EditarEventoDto,
  ): Promise<{ ok: true }> {
    try {
      await this.calendarService.editarEventoDesdeAgenda(user, user.id, eventId, {
        ...(dto.inicio ? { inicio: new Date(dto.inicio) } : {}),
        ...(dto.fin ? { fin: new Date(dto.fin) } : {}),
        ...(dto.resumen !== undefined ? { resumen: dto.resumen } : {}),
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof CalendarUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }
}
