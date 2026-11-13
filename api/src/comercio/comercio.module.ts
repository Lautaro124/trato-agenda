import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { HorarioAtencionModule } from '../horario-atencion/horario-atencion.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { PerformanceModule } from '../performance/performance.module.js';
import { SubscriptionModule } from '../subscription/subscription.module.js';
import { AnunciosController } from './anuncios.controller.js';
import { AnunciosService } from './anuncios.service.js';
import { AtencionPedidosService } from './atencion-pedidos.service.js';
import { BusquedaService } from './busqueda.service.js';
import { ConciliacionService } from './conciliacion.service.js';
import { CondicionesPagoController } from './condiciones-pago.controller.js';
import { CondicionesPagoService } from './condiciones-pago.service.js';
import { CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';
import { DecisionesClient } from './decisiones.client.js';
import { DescuentosController } from './descuentos.controller.js';
import { DescuentosService } from './descuentos.service.js';
import { HistoricoVentasService } from './historico.service.js';
import { ImagenesService } from './imagenes.service.js';
import { EmbeddingsClient } from './embeddings.client.js';
import { IndexadorService } from './indexador.service.js';
import { ProductosController } from './productos.controller.js';
import { MercadoPagoController } from './mercadopago.controller.js';
import { ProductosService } from './productos.service.js';
import { SugerenciasService } from './sugerencias.service.js';
import { VentasController } from './ventas.controller.js';
import { VentasService } from './ventas.service.js';
import { VisionClient } from './vision.client.js';

/**
 * Módulo comercio: el catálogo del asistente de ventas y su búsqueda (RAG),
 * los pedidos con su reserva de stock, las formas de pago (cuotas y efectivo) y los cobros con Mercado Pago a nombre
 * de cada comercio,, las fotos de los productos y los anuncios
 * desde los que llegan los clientes (LAU-103). Exporta búsqueda y ventas para el grafo de ventas
 * (api/src/conversation).
 */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [
    PassportModule.register({ session: false }),
    SubscriptionModule,
    NotificacionesModule,
    PerformanceModule,
    HorarioAtencionModule,
  ],
  controllers: [
    ProductosController,
    DescuentosController,
    VentasController,
    MercadoPagoController,
    CondicionesPagoController,
    AnunciosController,
  ],
  providers: [
    ProductosService,
    DescuentosService,
    BusquedaService,
    EmbeddingsClient,
    IndexadorService,
    VentasService,
    CuentaMercadoPagoService,
    ConciliacionService,
    HistoricoVentasService,
    DecisionesClient,
    SugerenciasService,
    ImagenesService,
    AtencionPedidosService,
    CondicionesPagoService,
    AnunciosService,
    VisionClient,
  ],
  exports: [
    BusquedaService,
    DecisionesClient,
    SugerenciasService,
    ProductosService,
    VentasService,
    CuentaMercadoPagoService,
    HistoricoVentasService,
    ImagenesService,
    AnunciosService,
    VisionClient,
  ],
})
export class ComercioModule {}
