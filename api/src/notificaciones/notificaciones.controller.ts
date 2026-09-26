import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { NotificacionesService, type ListadoNotificaciones } from './notificaciones.service.js';

class PaginaQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pagina?: number;
}

/** La campanita del panel. */
@Controller('notificaciones')
@UseGuards(JwtAuthGuard)
export class NotificacionesController {
  constructor(private readonly notificaciones: NotificacionesService) {}

  @Get()
  listar(@CurrentUser() user: User, @Query() query: PaginaQuery): Promise<ListadoNotificaciones> {
    return this.notificaciones.listar(user.id, query.pagina ?? 1);
  }

  /** Lo único que la web pide cada 30 segundos: barato a propósito. */
  @Get('no-leidas')
  async noLeidas(@CurrentUser() user: User): Promise<{ cantidad: number }> {
    return { cantidad: await this.notificaciones.noLeidas(user.id) };
  }

  @Post('leidas')
  @HttpCode(HttpStatus.NO_CONTENT)
  async marcarTodas(@CurrentUser() user: User): Promise<void> {
    await this.notificaciones.marcarTodas(user.id);
  }

  @Post(':id/leida')
  @HttpCode(HttpStatus.NO_CONTENT)
  async marcarLeida(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    await this.notificaciones.marcarLeida(user.id, id);
  }
}
