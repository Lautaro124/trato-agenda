/** Providers del runtime conversacional: el modelo, el checkpointer y el grafo compilado. */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ConfigService } from '@nestjs/config';
import { OpenRouterClient } from '../agents/openrouter.client.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { BusquedaService } from '../comercio/busqueda.service.js';
import type { Env } from '../config/env.js';
import { HistoricoVentasService } from '../comercio/historico.service.js';
import { ImagenesService } from '../comercio/imagenes.service.js';
import { SugerenciasService } from '../comercio/sugerencias.service.js';
import { VentasService } from '../comercio/ventas.service.js';
import { NotificacionesService } from '../notificaciones/notificaciones.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckpointerService } from './checkpointer.provider.js';
import { construirGrafo, type GrafoConversacion } from './graph/graph.factory.js';
import { LLM_CONVERSACION } from './llm.provider.js';
import { construirGrafoVentas, type GrafoVentas } from './ventas/grafo-ventas.factory.js';

export type { GrafoConversacion, GrafoVentas };

export const GRAFO_CONVERSACION = 'GRAFO_CONVERSACION';
export const GRAFO_VENTAS = 'GRAFO_VENTAS';

/** El grafo se compila una sola vez, al levantar el módulo. */
export const grafoProvider = {
  provide: GRAFO_CONVERSACION,
  inject: [PrismaService, CalendarService, OpenRouterClient, LLM_CONVERSACION, CheckpointerService, ConfigService],
  useFactory: (
    prisma: PrismaService,
    calendarService: CalendarService,
    openRouter: OpenRouterClient,
    llm: BaseChatModel,
    checkpointer: CheckpointerService,
    config: ConfigService<Env, true>,
  ): GrafoConversacion =>
    construirGrafo({
      prisma,
      calendarService,
      openRouter,
      llm,
      checkpointer: checkpointer.saver,
      ventanaHistorialMs: config.get('HISTORIAL_IA_VENTANA_MS', { infer: true }),
    }),
};

/** El grafo del asistente de ventas, con el mismo modelo y el mismo checkpointer. */
export const grafoVentasProvider = {
  provide: GRAFO_VENTAS,
  inject: [
    PrismaService,
    BusquedaService,
    SugerenciasService,
    VentasService,
    NotificacionesService,
    HistoricoVentasService,
    ImagenesService,
    OpenRouterClient,
    LLM_CONVERSACION,
    CheckpointerService,
    ConfigService,
  ],
  useFactory: (
    prisma: PrismaService,
    busqueda: BusquedaService,
    sugerencias: SugerenciasService,
    ventas: VentasService,
    notificaciones: NotificacionesService,
    historico: HistoricoVentasService,
    imagenes: ImagenesService,
    openRouter: OpenRouterClient,
    llm: BaseChatModel,
    checkpointer: CheckpointerService,
    config: ConfigService<Env, true>,
  ): GrafoVentas =>
    construirGrafoVentas({
      prisma,
      busqueda,
      sugerencias,
      ventas,
      notificaciones,
      historico,
      imagenes,
      openRouter,
      llm,
      checkpointer: checkpointer.saver,
      ventanaHistorialMs: config.get('HISTORIAL_IA_VENTANA_MS', { infer: true }),
    }),
};
