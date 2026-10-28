import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { HorarioAtencionController } from './horario-atencion.controller.js';
import { HorarioAtencionService } from './horario-atencion.service.js';

@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [HorarioAtencionController],
  providers: [HorarioAtencionService],
  // WhatsApp lo consulta antes de atender cada chat y para el estado del header.
  exports: [HorarioAtencionService],
})
export class HorarioAtencionModule {}
