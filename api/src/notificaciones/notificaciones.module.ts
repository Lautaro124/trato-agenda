import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { NotificacionesController } from './notificaciones.controller.js';
import { NotificacionesService } from './notificaciones.service.js';

/** Avisos al dueño. No importa ningún otro módulo del dominio a propósito (ver NotificacionesService). */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [NotificacionesController],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
