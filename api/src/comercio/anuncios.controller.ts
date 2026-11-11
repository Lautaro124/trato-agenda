import { Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, StreamableFile, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { AnunciosService, type AnuncioPublico } from './anuncios.service.js';

/** `productoId: null`: el anuncio no es de un producto del catálogo. */
export class AsociarAnuncioDto {
  @ValidateIf((_, valor) => valor !== null)
  @IsString()
  @MaxLength(64)
  productoId!: string | null;
}

/** Un anuncio que carga el dueño: el ID de Meta o el link, y su producto. */
export class CrearAnuncioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  anuncio!: string;

  @IsString()
  @MaxLength(64)
  productoId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;
}

/** Anuncios desde los que llegaron clientes (LAU-103), scopeados al usuario de la sesión. */
@Controller('anuncios')
@UseGuards(JwtAuthGuard)
export class AnunciosController {
  constructor(private readonly anuncios: AnunciosService) {}

  @Get()
  listar(@CurrentUser() user: User): Promise<AnuncioPublico[]> {
    return this.anuncios.listar(user.id);
  }

  @Post()
  crear(@CurrentUser() user: User, @Body() dto: CrearAnuncioDto): Promise<AnuncioPublico> {
    return this.anuncios.crear(user.id, dto.anuncio, dto.productoId, dto.nombre ?? null);
  }

  @Delete(':id')
  @HttpCode(204)
  eliminar(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.anuncios.eliminar(user.id, id);
  }

  @Get(':id/miniatura')
  @Header('Cache-Control', 'private, max-age=300')
  async miniatura(@CurrentUser() user: User, @Param('id') id: string): Promise<StreamableFile> {
    const datos = await this.anuncios.miniatura(user.id, id);
    return new StreamableFile(datos, { type: 'image/jpeg', length: datos.length });
  }

  @Put(':id')
  asociar(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: AsociarAnuncioDto): Promise<AnuncioPublico> {
    return this.anuncios.asociar(user.id, id, dto.productoId);
  }
}
