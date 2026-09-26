import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * Enchufa el chat propio de WhatsApp como canal de los avisos al dueño. Vive
 * acá y no en NotificacionesModule para no cerrar el ciclo de dependencias
 * (WhatsApp → conversación → comercio → avisos).
 */
@Injectable()
export class AvisosPorWhatsapp implements OnModuleInit {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  onModuleInit(): void {
    this.notificaciones.usarCanal((userId, texto) => this.whatsapp.enviarAlPropioChat(userId, texto));
  }
}
