import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { LinearClient } from './linear.client.js';
import { MejorasController } from './mejoras.controller.js';
import { MejorasService } from './mejoras.service.js';

/** Sugerencias de mejora que mandan los dueños desde el panel, copiadas a Linear (LAU-14). */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [MejorasController],
  providers: [MejorasService, LinearClient],
})
export class MejorasModule {}
