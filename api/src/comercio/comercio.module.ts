import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { BusquedaService } from './busqueda.service.js';
import { EmbeddingsClient } from './embeddings.client.js';
import { IndexadorService } from './indexador.service.js';
import { ProductosController } from './productos.controller.js';
import { ProductosService } from './productos.service.js';

/**
 * Módulo comercio: el catálogo del asistente de ventas y su búsqueda (RAG).
 * Exporta la búsqueda para el grafo de ventas (api/src/conversation).
 */
@Module({
  // JwtAuthGuard necesita AuthModuleOptions de PassportModule en el árbol de DI.
  imports: [PassportModule.register({ session: false })],
  controllers: [ProductosController],
  providers: [ProductosService, BusquedaService, EmbeddingsClient, IndexadorService],
  exports: [BusquedaService, ProductosService],
})
export class ComercioModule {}
