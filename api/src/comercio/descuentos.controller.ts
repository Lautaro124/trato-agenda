import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { DescuentosService } from './descuentos.service.js';
import { ActivarPromocionDto, PromocionDto, type DescuentoPublico } from './descuentos.types.js';

/** Promos del asistente de ventas (todo el catálogo o una categoría), scopeadas al usuario de la sesión. */
@Controller('descuentos')
@UseGuards(JwtAuthGuard)
export class DescuentosController {
  constructor(private readonly descuentos: DescuentosService) {}

  @Get()
  listar(@CurrentUser() user: User): Promise<DescuentoPublico[]> {
    return this.descuentos.listar(user.id);
  }

  @Post()
  crear(@CurrentUser() user: User, @Body() dto: PromocionDto): Promise<DescuentoPublico> {
    return this.descuentos.crear(user.id, dto);
  }

  @Put(':id')
  actualizar(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: PromocionDto): Promise<DescuentoPublico> {
    return this.descuentos.actualizar(user.id, id, dto);
  }

  @Patch(':id')
  activar(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ActivarPromocionDto,
  ): Promise<DescuentoPublico> {
    return this.descuentos.activar(user.id, id, dto.activo);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  eliminar(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.descuentos.eliminar(user.id, id);
  }
}
