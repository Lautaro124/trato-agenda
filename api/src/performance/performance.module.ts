import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { LecturaPerformanceService } from './lectura.service.js';
import { PerformanceController } from './performance.controller.js';
import { RegistroPerformanceService } from './registro.service.js';

/**
 * Módulo de performance de las cuentas de ventas (LAU-30): el registro de
 * etapas e interés por producto, y su lectura en `GET /performance`. No
 * importa ningún otro módulo del dominio, así comercio y conversación lo
 * pueden usar sin ciclos.
 */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [PerformanceController],
  providers: [RegistroPerformanceService, LecturaPerformanceService],
  exports: [RegistroPerformanceService],
})
export class PerformanceModule {}
