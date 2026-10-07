import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { BusquedaService } from './busqueda.service.js';
import { ConciliacionService } from './conciliacion.service.js';
import { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { DecisionesClient } from './decisiones.client.js';
import { HistoricoVentasService } from './historico.service.js';
import { EmbeddingsClient } from './embeddings.client.js';
import { IndexadorService } from './indexador.service.js';
import { ProductosController } from './productos.controller.js';
import { MercadoPagoController } from './mercadopago.controller.js';
import { ProductosService } from './productos.service.js';
import { SugerenciasService } from './sugerencias.service.js';
import { VentasController } from './ventas.controller.js';
import { VentasService } from './ventas.service.js';

/**
 * Módulo comercio: el catálogo del asistente de ventas y su búsqueda (RAG),
 * los pedidos con su reserva de stock y los cobros con Mercado Pago a nombre
 * de cada comercio. Exporta búsqueda y ventas para el grafo de ventas
 * (api/src/conversation).
 */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false }), SubscriptionModule, NotificacionesModule],
  controllers: [ProductosController, VentasController, MercadoPagoController],
  providers: [
    ProductosService,
    BusquedaService,
    EmbeddingsClient,
    IndexadorService,
    VentasService,
    CuentaMercadoPagoService,
    ConciliacionService,
    HistoricoVentasService,
    DecisionesClient,
    SugerenciasService,
  ],
  exports: [BusquedaService, SugerenciasService, ProductosService, VentasService, CuentaMercadoPagoService, HistoricoVentasService],
})
export class ComercioModule {}
