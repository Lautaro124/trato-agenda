/** Providers del runtime conversacional: el modelo, el checkpointer y el grafo compilado. */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { OpenRouterClient } from '../agents/openrouter.client.js';
import { CalendarService } from '../calendar/calendar.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CheckpointerService } from './checkpointer.provider.js';
import { construirGrafo, type GrafoConversacion } from './graph/graph.factory.js';
import { LLM_CONVERSACION } from './llm.provider.js';

export type { GrafoConversacion };

export const GRAFO_CONVERSACION = 'GRAFO_CONVERSACION';

/** El grafo se compila una sola vez, al levantar el módulo. */
export const grafoProvider = {
  provide: GRAFO_CONVERSACION,
  inject: [PrismaService, CalendarService, OpenRouterClient, LLM_CONVERSACION, CheckpointerService],
  useFactory: (
    prisma: PrismaService,
    calendarService: CalendarService,
    openRouter: OpenRouterClient,
    llm: BaseChatModel,
    checkpointer: CheckpointerService,
  ): GrafoConversacion =>
    construirGrafo({ prisma, calendarService, openRouter, llm, checkpointer: checkpointer.saver }),
};
