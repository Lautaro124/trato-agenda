import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  StreamableFile,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ArrayMaxSize, IsArray, IsObject } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { MAX_BYTES_SUBIDA } from './imagenes.rules.js';
import { MAX_PREGUNTAS, type PreguntaPedido } from './preguntas-pedido.rules.js';
import { PreguntasService } from './preguntas.service.js';

export class GuardarPreguntasDto {
  /** La forma de cada una la valida normalizarPreguntas (preguntas-pedido.rules.ts). */
  @IsArray()
  @ArrayMaxSize(MAX_PREGUNTAS)
  @IsObject({ each: true })
  preguntas!: Array<Record<string, unknown>>;
}

const SUBIDA = FileInterceptor('imagen', { limits: { fileSize: MAX_BYTES_SUBIDA, files: 1, fields: 0, parts: 1 } });

/** Preguntas del pedido de la cuenta (LAU-100). */
@Controller('preguntas')
@UseGuards(JwtAuthGuard)
export class PreguntasController {
  constructor(private readonly preguntas: PreguntasService) {}

  @Get()
  async obtener(@CurrentUser() user: User): Promise<{ preguntas: PreguntaPedido[] }> {
    return { preguntas: await this.preguntas.obtener(user.id) };
  }

  @Put()
  async guardar(@CurrentUser() user: User, @Body() dto: GuardarPreguntasDto): Promise<{ preguntas: PreguntaPedido[] }> {
    return { preguntas: await this.preguntas.guardar(user.id, dto.preguntas) };
  }

  /** Recomprimida en el servicio: nunca se guarda el archivo tal como llegó. */
  @Post('imagenes')
  @UseInterceptors(SUBIDA)
  subirImagen(@CurrentUser() user: User, @UploadedFile() archivo: { buffer: Buffer } | undefined): Promise<{ id: string }> {
    if (!archivo) throw new UnprocessableEntityException('Falta la imagen.');
    return this.preguntas.subirImagen(user.id, archivo.buffer);
  }

  /** Las imágenes no cambian (una nueva es otro id): se pueden cachear. */
  @Get('imagenes/:id')
  @Header('Cache-Control', 'private, max-age=86400')
  async imagen(@CurrentUser() user: User, @Param('id') id: string): Promise<StreamableFile> {
    const datos = await this.preguntas.imagen(user.id, id);
    return new StreamableFile(datos, { type: 'image/jpeg', length: datos.length });
  }
}
