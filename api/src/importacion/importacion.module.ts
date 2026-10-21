import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ComercioModule } from '../comercio/comercio.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { ImportacionController } from './importacion.controller.js';
import { ImportacionService } from './importacion.service.js';
import { MercadoLibreClient } from './mercadolibre.client.js';

/**
 * Importación rápida de productos (LAU-31), aparte del catálogo: todo lo que
 * sale a internet a leer páginas de otros vive acá, detrás de fetch-seguro.ts.
 * Del catálogo sólo usa lo que ya exporta (ProductosService, ImagenesService).
 */
@Module({
  imports: [PassportModule.register({ session: false }), ComercioModule, SubscriptionModule],
  controllers: [ImportacionController],
  providers: [ImportacionService, MercadoLibreClient],
})
export class ImportacionModule {}
