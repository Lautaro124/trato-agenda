import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../../../agents/openrouter.client.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { EstadoComun } from '../state.js';
import { CADA_CUANTOS_MENSAJES_RESUMIR, crearNodoPersistir } from './persistir.node.js';

const ANALISIS_PREVIO = {
  probabilidad: 20,
  sentimiento: 'neutro',
  tendencia: 'estable',
  aFavor: [],
  enContra: [],
  presupuesto: 'Hasta 500 mil',
  tema: 'otro',
  proximoPaso: 'Mandale fotos.',
  mensajeSugerido: null,
  actualizadoAt: '2026-11-18T10:00:00.000Z',
};

function crearPrisma(total: number, analisis: unknown = null) {
  const guardado: { analisis: unknown } = { analisis };
  const prisma = {
    message: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(total),
      findMany: vi.fn().mockResolvedValue([
        { role: 'assistant', content: { content: '¿Qué buscás?' }, createdAt: new Date('2026-11-19T10:01:00Z') },
        { role: 'user', content: { content: 'Un esquinero, ¿cómo pago?' }, createdAt: new Date('2026-11-19T10:00:00Z') },
      ]),
    },
    conversation: {
      findUnique: vi.fn(async () => ({ analisis: guardado.analisis })),
      update: vi.fn(async ({ data }: { data: { analisis?: unknown } }) => {
        if (data.analisis) guardado.analisis = JSON.parse(JSON.stringify(data.analisis));
        return {};
      }),
    },
  };
  return { prisma, guardado };
}

function estado(): EstadoComun {
  return {
    messages: [new HumanMessage('Un esquinero, ¿cómo pago?'), new AIMessage('Te paso las formas de pago.')],
    esPropietario: false,
    indiceDesde: 0,
    inicioVisible: 0,
    contexto: { conversation: { id: 'conv1', resumen: null, nombreCliente: null } } as unknown as EstadoComun['contexto'],
  };
}

const decisiones = (respuestas: Record<string, unknown>) => ({
  configurado: true,
  decidir: vi.fn().mockResolvedValue(respuestas),
});

function openRouter(contenido: string) {
  return { chat: vi.fn().mockResolvedValue({ content: contenido }) } as unknown as OpenRouterClient & { chat: ReturnType<typeof vi.fn> };
}

describe('persistir: análisis de la venta (híbrido)', () => {
  it('con Jev, analiza en cada mensaje del cliente sin llamar al modelo de chat y conserva sus textos', async () => {
    const { prisma, guardado } = crearPrisma(CADA_CUANTOS_MENSAJES_RESUMIR + 1, ANALISIS_PREVIO);
    const jev = decisiones({ compra: 0.81, sentimiento: { positivo: 0.9 }, senal_pago: 0.95 });
    const chat = openRouter('{}');

    await crearNodoPersistir({ prisma: prisma as unknown as PrismaService, openRouter: chat, analizarVenta: true, decisiones: jev })(estado());

    expect(jev.decidir).toHaveBeenCalledOnce();
    const [estadoJev] = jev.decidir.mock.calls[0] as [string];
    expect(estadoJev).toBe('Customer: Un esquinero, ¿cómo pago?\nShop: ¿Qué buscás?');
    expect(chat.chat).not.toHaveBeenCalled();
    expect(guardado.analisis).toMatchObject({
      probabilidad: 81,
      sentimiento: 'positivo',
      aFavor: ['Preguntó cómo pagar'],
      presupuesto: 'Hasta 500 mil',
      proximoPaso: 'Mandale fotos.',
    });
  });

  it('cada pocos mensajes, el modelo de chat sólo agrega los textos', async () => {
    const { prisma, guardado } = crearPrisma(CADA_CUANTOS_MENSAJES_RESUMIR);
    const jev = decisiones({ compra: 0.7 });
    const chat = openRouter(JSON.stringify({ resumen: 'Busca un esquinero.', proximoPaso: 'Pasale el link de pago.', probabilidad: 5 }));

    await crearNodoPersistir({ prisma: prisma as unknown as PrismaService, openRouter: chat, analizarVenta: true, decisiones: jev })(estado());

    expect(chat.chat).toHaveBeenCalledOnce();
    // La probabilidad sigue siendo la de Jev, no la que haya dicho el modelo de chat.
    expect(guardado.analisis).toMatchObject({ probabilidad: 70, proximoPaso: 'Pasale el link de pago.' });
    expect(prisma.conversation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resumen: 'Busca un esquinero.' }) }),
    );
  });

  it('si Jev falla y no hay análisis, el modelo de chat estima todo como antes', async () => {
    const { prisma, guardado } = crearPrisma(CADA_CUANTOS_MENSAJES_RESUMIR);
    const jev = { configurado: true, decidir: vi.fn().mockRejectedValue(new Error('timeout')) };
    const chat = openRouter(JSON.stringify({ resumen: 'Busca un esquinero.', probabilidad: 55 }));

    await crearNodoPersistir({ prisma: prisma as unknown as PrismaService, openRouter: chat, analizarVenta: true, decisiones: jev })(estado());

    expect(guardado.analisis).toMatchObject({ probabilidad: 55 });
  });

  it('sin Jev configurado no le pregunta y entre resúmenes no hace nada', async () => {
    const { prisma } = crearPrisma(CADA_CUANTOS_MENSAJES_RESUMIR + 1);
    const jev = { configurado: false, decidir: vi.fn() };
    const chat = openRouter('{}');

    await crearNodoPersistir({ prisma: prisma as unknown as PrismaService, openRouter: chat, analizarVenta: true, decisiones: jev })(estado());

    expect(jev.decidir).not.toHaveBeenCalled();
    expect(chat.chat).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
