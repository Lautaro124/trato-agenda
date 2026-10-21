import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { ImportacionService } from './importacion.service.js';
import { ConfirmarDto, ExtraerDto } from './importacion.types.js';
import type { ResultadoConfirmacion, ResultadoExtraccion } from './modelo.js';

/** Importación rápida de productos desde enlaces (LAU-31): plan Pro, cuentas de ventas. */
@Controller('importacion')
@UseGuards(JwtAuthGuard)
export class ImportacionController {
  constructor(private readonly importacion: ImportacionService) {}

  /** 204 si la cuenta puede importar; 409/403 con el motivo si no. La pantalla lo usa para mostrar el aviso del Pro. */
  @Get('acceso')
  @HttpCode(HttpStatus.NO_CONTENT)
  acceso(@CurrentUser() user: User): Promise<void> {
    return this.importacion.exigirAcceso(user.id);
  }

  /** Lee los enlaces y devuelve borradores para revisar. No escribe nada. */
  @Post('extraer')
  @HttpCode(HttpStatus.OK)
  extraer(@CurrentUser() user: User, @Body() dto: ExtraerDto): Promise<ResultadoExtraccion> {
    return this.importacion.extraer(user.id, dto.urls);
  }

  /** Guarda los productos que el dueño revisó y eligió. */
  @Post('confirmar')
  @HttpCode(HttpStatus.OK)
  confirmar(@CurrentUser() user: User, @Body() dto: ConfirmarDto): Promise<ResultadoConfirmacion> {
    return this.importacion.confirmar(user.id, dto.productos);
  }
}
