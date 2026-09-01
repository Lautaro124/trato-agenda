import { Controller, Get, HttpCode, HttpStatus, Post, Sse, UseGuards, type MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { WhatsappService } from './whatsapp.service.js';
import type { WhatsappStatus } from './whatsapp.types.js';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('status')
  status(@CurrentUser() user: User): Promise<WhatsappStatus> {
    return this.whatsappService.status(user.id);
  }

  @Post('link/start')
  @HttpCode(HttpStatus.ACCEPTED)
  startLink(@CurrentUser() user: User): Promise<void> {
    return this.whatsappService.startLink(user.id);
  }

  @Sse('link/stream')
  linkStream(@CurrentUser() user: User): Observable<MessageEvent> {
    return this.whatsappService.linkEvents$(user.id);
  }

  @Post('unlink')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlink(@CurrentUser() user: User): Promise<void> {
    return this.whatsappService.unlink(user.id);
  }
}
