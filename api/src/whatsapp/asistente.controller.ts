import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { User } from '../generated/prisma/client.js';
import { estadoDelAsistente, type EstadoAsistente } from '../horario-atencion/horario-atencion.rules.js';
import { HorarioAtencionService } from '../horario-atencion/horario-atencion.service.js';
import { SubscriptionService } from '../subscription/subscription.service.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * Si el asistente está contestando por WhatsApp ahora (LAU-29), para el badge
 * del header. Junta lo mismo que mira `handleMessagesUpsert` antes de atender:
 * la vinculación, la suscripción y el horario de atención.
 */
@Controller('asistente')
@UseGuards(JwtAuthGuard)
export class AsistenteController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly suscripcion: SubscriptionService,
    private readonly horarioAtencion: HorarioAtencionService,
  ) {}

  @Get('estado')
  async estado(@CurrentUser() user: User): Promise<EstadoAsistente> {
    const [status, suscripcionActiva, horario] = await Promise.all([
      this.whatsapp.status(user.id),
      this.suscripcion.asistenteActivo(user.id),
      this.horarioAtencion.leer(user.id),
    ]);
    return estadoDelAsistente({ vinculado: status.linked, suscripcionActiva, horario, ahora: new Date() });
  }
}
