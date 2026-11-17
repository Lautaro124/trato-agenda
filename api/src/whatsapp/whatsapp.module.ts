import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ComercioModule } from '../comercio/comercio.module.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { HorarioAtencionModule } from '../horario-atencion/horario-atencion.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { AsistenteController } from './asistente.controller.js';
import { AvisosPorWhatsapp } from './avisos-por-whatsapp.js';
import { WhatsappController } from './whatsapp.controller.js';
import { TranscripcionClient } from './transcripcion.client.js';
import { WhatsappService } from './whatsapp.service.js';
import { MetaGraphClient } from './meta/meta-graph.client.js';
import { MetaWebhookController } from './meta/meta-webhook.controller.js';
import { MetaWhatsappService } from './meta/meta-whatsapp.service.js';

@Module({
  // JwtAuthGuard (AuthGuard('jwt')) necesita AuthModuleOptions de PassportModule
  // en el árbol de DI de este módulo, igual que en AuthModule.
  imports: [
    PassportModule.register({ session: false }),
    ConversationModule,
    SubscriptionModule,
    HorarioAtencionModule,
    NotificacionesModule,
    // Las fotos de productos que manda el asistente de ventas.
    ComercioModule,
  ],
  // Exportados para la baja de cuenta (cerrar el socket de Baileys y sacar la
  // app de la WABA) y para el alta con WhatsApp Business.
  exports: [WhatsappService, MetaWhatsappService],
  controllers: [WhatsappController, AsistenteController, MetaWebhookController],
  providers: [WhatsappService, AvisosPorWhatsapp, TranscripcionClient, MetaGraphClient, MetaWhatsappService],
})
export class WhatsappModule {}
