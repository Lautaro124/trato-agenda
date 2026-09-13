import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../../../agents/openrouter.client.js';
import { LIMITE_RECURSION, construirGrafo } from '../graph.factory.js';
import { CADA_CUANTOS_MENSAJES_RESUMIR } from '../nodes/persistir.node.js';
import { AGENT, CONVERSATION, crearCalendar, crearModelo, hora } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Prisma con un contador de "total de mensajes" controlado por vuelta, no por
 * cantidad real de filas insertadas: persistir.node.ts llama `message.count()`
 * una vez por invoke para decidir el umbral, y acá lo que importa es poder
 * pararse exactamente en total=5/6/7, no simular el conteo real de filas.
 */
function prismaConContador() {
  const conversacion = { ...CONVERSATION, resumen: null as string | null };
  let totalMensajes = 0;
  const prisma = {
    agent: { findUnique: vi.fn().mockResolvedValue(AGENT) },
    conversation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(conversacion),
      update: vi.fn().mockImplementation(({ data }) => {
        Object.assign(conversacion, data);
        return Promise.resolve({ ...conversacion });
      }),
    },
    turno: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    message: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockImplementation(() => Promise.resolve(++totalMensajes)),
    },
  };
  return { prisma, conversacion };
}

describe('umbral de resumen del cliente (matriz D)', () => {
  it('D-001/D-002/D-003: no resume en 5, resume en 6, no vuelve a resumir en 7', async () => {
    expect(CADA_CUANTOS_MENSAJES_RESUMIR).toBe(6);

    const { prisma, conversacion } = prismaConContador();
    const calendarService = crearCalendar();
    const llm = crearModelo([new AIMessage('Gracias, avisame cualquier cosa.')]);
    const chat = vi.fn().mockResolvedValue({ content: 'Resumen actualizado del cliente.' });
    const openRouter = { chat } as unknown as OpenRouterClient;
    const checkpointer = new MemorySaver();

    const grafo = construirGrafo({ prisma: prisma as never, calendarService, llm, openRouter, checkpointer });

    const resumenPorVuelta: (string | null)[] = [];
    for (let vuelta = 1; vuelta <= CADA_CUANTOS_MENSAJES_RESUMIR + 1; vuelta += 1) {
      await grafo.invoke(
        { messages: [new HumanMessage(`mensaje ${vuelta}`)], ownerUserId: 'user-1', remoteJid: CONVERSATION.remoteJid, esPropietario: false },
        { configurable: { thread_id: 'hist-resumen' }, recursionLimit: LIMITE_RECURSION },
      );
      resumenPorVuelta.push(conversacion.resumen);
    }

    expect(resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR - 2]).toBeNull(); // en 5
    expect(resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR - 1]).toBe('Resumen actualizado del cliente.'); // en 6
    expect(chat).toHaveBeenCalledTimes(1);
    expect(resumenPorVuelta[CADA_CUANTOS_MENSAJES_RESUMIR]).toBe('Resumen actualizado del cliente.'); // en 7, sin cambios
  });

  it('D-010: si el resumen falla, la respuesta al cliente no se ve afectada', async () => {
    const { prisma } = prismaConContador();
    const calendarService = crearCalendar();
    // Una instancia nueva de AIMessage por invoke: reusar el mismo objeto en
    // varias vueltas del mismo thread confunde al reducer de mensajes del
    // checkpointer (le asigna id la primera vez que lo serializa).
    const llm = {
      invoke: vi.fn().mockImplementation(async () => new AIMessage('Todo bien.')),
      bindTools: function (this: unknown) { return this; },
    };
    llm.bindTools = llm.bindTools.bind(llm);
    const chat = vi.fn().mockRejectedValue(new Error('OpenRouter caído'));
    const openRouter = { chat } as unknown as OpenRouterClient;
    const checkpointer = new MemorySaver();

    const grafo = construirGrafo({ prisma: prisma as never, calendarService, llm: llm as never, openRouter, checkpointer });

    let ultimoEstado;
    for (let vuelta = 1; vuelta <= CADA_CUANTOS_MENSAJES_RESUMIR; vuelta += 1) {
      ultimoEstado = await grafo.invoke(
        { messages: [new HumanMessage(`mensaje ${vuelta}`)], ownerUserId: 'user-1', remoteJid: CONVERSATION.remoteJid, esPropietario: false },
        { configurable: { thread_id: 'hist-resumen-falla' }, recursionLimit: LIMITE_RECURSION },
      );
    }

    expect(ultimoEstado?.messages.at(-1)?.content).toBe('Todo bien.');
  });
});
