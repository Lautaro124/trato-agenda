import { Body, Controller, Delete, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConversationService, jidDePrueba } from './conversation.service.js';

class EnviarMensajeDto {
  @IsString()
  @MinLength(1)
  message!: string;
}

@Controller('conversation')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly prisma: PrismaService,
  ) {}

  /** Banco de pruebas del Home: le habla al mismo agente que WhatsApp, de verdad. */
  @Post('test')
  async test(@CurrentUser() user: User, @Body() dto: EnviarMensajeDto): Promise<{ reply: string }> {
    const reply = await this.conversationService.handleIncoming(user.id, jidDePrueba(user.id), dto.message);
    return { reply };
  }

  @Delete('test')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reset(@CurrentUser() user: User): Promise<void> {
    await this.prisma.conversation.deleteMany({
      where: { userId: user.id, remoteJid: jidDePrueba(user.id) },
    });
  }
}
