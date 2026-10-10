import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ComercioModule } from '../comercio/comercio.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { AvisosPorWhatsapp } from './avisos-por-whatsapp.js';
import { WhatsappController } from './whatsapp.controller.js';
import { WhatsappService } from './whatsapp.service.js';

@Module({
  // JwtAuthGuard (AuthGuard('jwt')) necesita AuthModuleOptions de PassportModule
  // en el árbol de DI de este módulo, igual que en AuthModule.
  imports: [
    PassportModule.register({ session: false }),
    ConversationModule,
    SubscriptionModule,
    NotificacionesModule,
    // Las fotos de productos que manda el asistente de ventas.
    ComercioModule,
  ],
  // Exportado para la baja de cuenta, que necesita cerrar el socket de Baileys.
  exports: [WhatsappService],
  controllers: [WhatsappController],
  providers: [WhatsappService, AvisosPorWhatsapp],
})
export class WhatsappModule {}
