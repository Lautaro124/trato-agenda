/**
 * Eval del resumen de cliente contra OpenRouter real. `conversacion.eval.ts`
 * stubbea a propósito `openRouter.chat` (no es lo que mide ese eval); acá es
 * al revés: el modelo de charla (`llm`) queda stubbeado con una respuesta fija
 * sin tool calls, así el costo y la latencia medidos son sólo los de
 * `actualizarResumen` (persistir.node.ts), no los de la conversación completa.
 *
 * Verifica el umbral real `CADA_CUANTOS_MENSAJES_RESUMIR` (persistir.node.ts):
 * en 5 mensajes no debe resumir, en 6 sí, en 7 no vuelve a resumir.
 *
 *   docker compose exec api npm run eval -- resumen
 */
import 'dotenv/config';
import 'reflect-metadata';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import type { ConfigService } from '@nestjs/config';
import { afterAll, describe, expect, it } from 'vitest';
import { OpenRouterClient } from '../../src/agents/openrouter.client.js';
import { CalendarService } from '../../src/calendar/calendar.service.js';
import { OPENROUTER_BASE_URL_POR_DEFECTO, type Env } from '../../src/config/env.js';
import { CADA_CUANTOS_MENSAJES_RESUMIR } from '../../src/conversation/graph/nodes/persistir.node.js';
import { LIMITE_RECURSION, construirGrafo } from '../../src/conversation/graph/graph.factory.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { HAY_CLAVE, modelosDelEval } from '../modelos.js';
import { guardarReporte, type Resultado } from '../reporte.js';

const AHORA = new Date('2026-09-14T08:00:00-03:00');

const USUARIO = { id: 'eval-resumen-owner', googleId: 'dev:eval-resumen@trato.local', googleRefreshToken: null, email: 'eval-resumen@trato.local' };

const AGENTE = {
  id: 'eval-resumen-agent',
  userId: USUARIO.id,
  tipoUso: 'comercio',
  descripcion: 'Negocio: Barbería Sur (comercio).',
  tipoTitular: 'negocio',
  nombreTitular: 'Barbería Sur',
  nombreBot: 'Bruno',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [{ nombre: 'Corte', duracionMin: 30 }],
  systemPrompt: 'Sos Bruno, asistente de Barbería Sur.',
  allowedActions: ['consultar_disponibilidad', 'crear_turno'],
  model: 'eval',
  createdAt: AHORA,
  updatedAt: AHORA,
  user: USUARIO,
};

/** El llm de charla queda fijo: lo que se mide acá es sólo actualizarResumen. */
function llmFijo(): BaseChatModel {
  const invoke = async () => new AIMessage('Gracias, cualquier cosa avisame.');
  return { invoke, bindTools: () => ({ invoke }) } as unknown as BaseChatModel;
}

function configPara(modelo: string): ConfigService<Env, true> {
  const valores: Record<string, string> = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL_POR_DEFECTO,
    OPENROUTER_MODEL: modelo,
  };
  return { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
}

/**
 * Prisma en memoria con un contador de mensajes real (uno por invoke, como en
 * la conversación de verdad: humano + respuesta cuentan como dos filas, pero
 * acá basta con que crezca de a uno por vuelta para poder pararse justo en
 * 5/6/7 sin depender de cuántas filas exactas mete cada nodo).
 */
function prismaEnMemoria() {
  const conversacion = {
    id: 'eval-resumen-conv',
    userId: USUARIO.id,
    remoteJid: '5491100000001@s.whatsapp.net',
    resumen: null as string | null,
    nombreCliente: null as string | null,
    createdAt: AHORA,
    updatedAt: AHORA,
  };
  let mensajes = 0;
  const prisma = {
    agent: { findUnique: async () => AGENTE },
    conversation: {
      findUniqueOrThrow: async () => ({ ...conversacion }),
      update: async ({ data }: { data: Partial<typeof conversacion> }) => Object.assign(conversacion, data),
    },
    turno: { findFirst: async () => null, findMany: async () => [] },
    message: { create: async () => { mensajes += 1; return {}; }, count: async () => mensajes },
  };
  return { prisma: prisma as unknown as PrismaService, conversacion };
}

describe.skipIf(!HAY_CLAVE)('eval: resumen de cliente (camino real)', () => {
  const resultados: Resultado[] = [];
  afterAll(() => guardarReporte('resumen', resultados));

  for (const modelo of modelosDelEval()) {
    it(`${modelo} · umbral de resumen en ${CADA_CUANTOS_MENSAJES_RESUMIR - 1}/${CADA_CUANTOS_MENSAJES_RESUMIR}/${CADA_CUANTOS_MENSAJES_RESUMIR + 1} mensajes`, async () => {
      const config = configPara(modelo);
      const { prisma, conversacion } = prismaEnMemoria();
      const calendario = { freeBusy: async () => [] } as unknown as CalendarService;
      const openRouter = new OpenRouterClient(config);
      const grafo = construirGrafo({
        prisma,
        calendarService: calendario,
        llm: llmFijo(),
        openRouter,
        checkpointer: new MemorySaver(),
      });

      const resultado: Resultado = {
        modelo,
        caso: 'umbral-resumen',
        ok: false,
        checks: {},
        latenciasMs: [],
        llamadas: 0,
        tokensSalida: 0,
        costoUsd: 0,
      };

      try {
        const resumenPorVuelta: (string | null)[] = [];
        // Cada mensaje "hola" es intrascendente: lo único que importa es llegar
        // a los totales 5/6/7 para chequear el umbral, no el contenido.
        for (let vuelta = 1; vuelta <= CADA_CUANTOS_MENSAJES_RESUMIR + 1; vuelta += 1) {
          const inicio = performance.now();
          await grafo.invoke(
            { messages: [new HumanMessage(`mensaje ${vuelta}`)], ownerUserId: USUARIO.id, remoteJid: conversacion.remoteJid, esPropietario: false },
            { configurable: { thread_id: `resumen-${modelo}` }, recursionLimit: LIMITE_RECURSION },
          );
          resultado.latenciasMs.push(Math.round(performance.now() - inicio));
          resumenPorVuelta.push(conversacion.resumen);
        }

        resultado.checks = {
          [`sin_resumen_en_${CADA_CUANTOS_MENSAJES_RESUMIR - 1}`]: resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR - 2] === null,
          [`resume_en_${CADA_CUANTOS_MENSAJES_RESUMIR}`]: typeof resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR - 1] === 'string' && resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR - 1]!.length > 0,
          [`no_vuelve_a_resumir_en_${CADA_CUANTOS_MENSAJES_RESUMIR + 1}`]: resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR] === resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR - 1],
        };
        resultado.detalle = JSON.stringify({ resumenPorVuelta });
      } catch (error) {
        resultado.error = (error as Error).message;
        resultado.checks = { corre: false };
      } finally {
        resultado.ok = Object.values(resultado.checks).every(Boolean);
        resultados.push(resultado);
      }

      expect.soft(resultado.error, 'el grafo no debería fallar').toBeUndefined();
      for (const [check, paso] of Object.entries(resultado.checks)) {
        expect.soft(paso, check).toBe(true);
      }
    });
  }
});
