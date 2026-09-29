import { Injectable, type OnModuleInit } from '@nestjs/common';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * Enchufa WhatsApp como canal de los avisos: el chat propio para los del
 * dueño y el chat del cliente para los mensajes del negocio a él. Vive
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
    this.notificaciones.usarCanalCliente((userId, remoteJid, texto) =>
      this.whatsapp.enviarAlCliente(userId, remoteJid, texto),
    );
  }
}
