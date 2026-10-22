import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RangoInvalidoError } from '../comercio/historico.rules.js';
import type { User } from '../generated/prisma/client.js';
import { LecturaPerformanceService } from './lectura.service.js';
import { FiltrosPerformanceQuery, type PerformancePublica } from './performance.types.js';

/** El rendimiento de los productos y de los chats de una cuenta de ventas (LAU-30). */
@Controller('performance')
export class PerformanceController {
  constructor(private readonly lectura: LecturaPerformanceService) {}

  /** Conversión, etapas y productos de los chats nuevos del período. */
  @Get()
  @UseGuards(JwtAuthGuard)
  async leer(@CurrentUser() user: User, @Query() filtros: FiltrosPerformanceQuery): Promise<PerformancePublica> {
    try {
      return await this.lectura.leer(user.id, filtros);
    } catch (error) {
      if (error instanceof RangoInvalidoError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
