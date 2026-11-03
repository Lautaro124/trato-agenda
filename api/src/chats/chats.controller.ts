import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { ChatsService } from './chats.service.js';
import {
  CambiarAtencionDto,
  EnviarMensajeDto,
  type CambioDeAtencion,
  type DetalleChat,
  type ListaChats,
  type MensajeChat,
} from './chats.types.js';

/** Módulo de Chats (LAU-81). Todo del usuario autenticado. */
@Controller('chats')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  listar(@CurrentUser() user: User): Promise<ListaChats> {
    return this.chats.listar(user.id);
  }

  /** Avisa que algo cambió en los chats de la cuenta; la web vuelve a pedir la lista y el chat abierto. */
  @Sse('eventos')
  eventos(@CurrentUser() user: User): Observable<MessageEvent> {
    return this.chats.eventos$(user.id);
  }

  @Get(':id')
  detalle(@CurrentUser() user: User, @Param('id') id: string): Promise<DetalleChat> {
    return this.chats.detalle(user.id, id);
  }

  /** "Tomar el control" o "Devolver al bot". */
  @Post(':id/atencion')
  @HttpCode(HttpStatus.OK)
  atencion(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CambiarAtencionDto): Promise<CambioDeAtencion> {
    return this.chats.cambiarAtencion(user.id, id, dto);
  }

  /** Un mensaje del dueño al cliente, por su WhatsApp. */
  @Post(':id/mensajes')
  enviar(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: EnviarMensajeDto): Promise<MensajeChat> {
    return this.chats.enviar(user.id, id, dto);
  }
}
