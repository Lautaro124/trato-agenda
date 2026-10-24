import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { HorarioAtencionService } from './horario-atencion.service.js';
import { ActualizarHorarioAtencionDto, type HorarioAtencionPublico } from './horario-atencion.types.js';

/** El horario de atención de la cuenta (LAU-29), que se edita en /cuenta. */
@Controller('horario-atencion')
@UseGuards(JwtAuthGuard)
export class HorarioAtencionController {
  constructor(private readonly horarioAtencion: HorarioAtencionService) {}

  @Get()
  leer(@CurrentUser() user: User): Promise<HorarioAtencionPublico> {
    return this.horarioAtencion.publico(user.id);
  }

  @Put()
  actualizar(@CurrentUser() user: User, @Body() dto: ActualizarHorarioAtencionDto): Promise<HorarioAtencionPublico> {
    return this.horarioAtencion.actualizar(user.id, dto);
  }
}
