import { AIMessage } from '@langchain/core/messages';
import { GraphRecursionError } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { GrafoConversacion } from './conversation.providers.js';
import { ConversationService, jidDePrueba } from './conversation.service.js';

function crearPrisma(agent: unknown = { id: 'agent-1' }, filas: unknown[] = []) {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(agent) },
    conversation: {
      upsert: vi.fn().mockResolvedValue({ id: 'conv-1', remoteJid: '54911@s.whatsapp.net' }),
    },
    message: { findMany: vi.fn().mockResolvedValue(filas) },
  } as unknown as PrismaService;
}

function crearGrafo(respuesta: unknown, mensajesEnCheckpoint: unknown[] = []) {
  const invoke =
    respuesta instanceof Error
      ? vi.fn().mockRejectedValue(respuesta)
      : vi.fn().mockResolvedValue({ messages: [new AIMessage(String(respuesta))] });
  const getState = vi.fn().mockResolvedValue({ values: { messages: mensajesEnCheckpoint } });
  return { invoke, getState } as unknown as GrafoConversacion & {
    invoke: typeof invoke;
    getState: typeof getState;
  };
}

describe('ConversationService.handleIncoming', () => {
  it('sin Agent configurado, no invoca el grafo ni crea la conversación', async () => {
    const prisma = crearPrisma(null);
    const grafo = crearGrafo('irrelevante');
    const service = new ConversationService(prisma, grafo);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    expect(respuesta).toContain('no está configurado');
    expect(grafo.invoke).not.toHaveBeenCalled();
    expect(prisma.conversation.upsert).not.toHaveBeenCalled();
  });

  it('devuelve el texto del último mensaje del grafo y usa la conversación como hilo', async () => {
    const prisma = crearPrisma();
    const grafo = crearGrafo('Hola, soy Tati.');
    const service = new ConversationService(prisma, grafo);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    expect(respuesta).toBe('Hola, soy Tati.');
    expect(grafo.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: 'user-1', esPropietario: false }),
      expect.objectContaining({ configurable: { thread_id: 'conv-1' } }),
    );
  });

  it('marca esPropietario cuando el mensaje viene del banco de pruebas del Home', async () => {
    const prisma = crearPrisma();
    const grafo = crearGrafo('Hola, dueño.');
    const service = new ConversationService(prisma, grafo);

    await service.handleIncoming('user-1', jidDePrueba('user-1'), 'hola');

    expect(grafo.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ esPropietario: true }),
      expect.anything(),
    );
  });

  it('siembra el historial de la tabla Message cuando el hilo no tiene checkpoint', async () => {
    const prisma = crearPrisma({ id: 'agent-1' }, [
      { role: 'assistant', content: { content: '¿En qué te ayudo?' } },
      { role: 'user', content: { content: 'hola' } },
    ]);
    const grafo = crearGrafo('Dale.');
    const service = new ConversationService(prisma, grafo);

    await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'quiero un turno');

    const [entrada] = grafo.invoke.mock.calls[0] as [{ messages: unknown[] }];
    // Los dos mensajes viejos + el nuevo del cliente.
    expect(entrada.messages).toHaveLength(3);
  });

  it('con el hilo ya en el checkpointer no relee la tabla Message', async () => {
    const prisma = crearPrisma({ id: 'agent-1' }, [{ role: 'user', content: { content: 'hola' } }]);
    const grafo = crearGrafo('Dale.', [new AIMessage('ya estaba')]);
    const service = new ConversationService(prisma, grafo);

    await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'quiero un turno');

    expect(prisma.message.findMany).not.toHaveBeenCalled();
    const [entrada] = grafo.invoke.mock.calls[0] as [{ messages: unknown[] }];
    expect(entrada.messages).toHaveLength(1);
  });

  it('si el grafo se queda sin vueltas, responde que lo va a confirmar', async () => {
    const prisma = crearPrisma();
    const grafo = crearGrafo(new GraphRecursionError('sin vueltas'));
    const service = new ConversationService(prisma, grafo);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    expect(respuesta).toContain('Dejame confirmarlo');
  });

  it('ante cualquier otra falla del grafo, responde la disculpa genérica', async () => {
    const prisma = crearPrisma();
    const grafo = crearGrafo(new Error('se cayó todo'));
    const service = new ConversationService(prisma, grafo);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    expect(respuesta).toContain('Perdón');
  });

  it('un agente de ventas va al grafo de ventas, no al de agenda', async () => {
    const prisma = crearPrisma({ id: 'agent-1', tipoAsistente: 'ventas' });
    const agenda = crearGrafo('soy la agenda');
    const ventas = crearGrafo('soy el de ventas');
    const service = new ConversationService(prisma, agenda, ventas as never);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', '¿tenés mates?');

    expect(respuesta).toBe('soy el de ventas');
    expect(agenda.invoke).not.toHaveBeenCalled();
    expect(ventas.getState).toHaveBeenCalled();
  });

  it('un agente sin tipoAsistente (los de antes) sigue en la agenda', async () => {
    const prisma = crearPrisma({ id: 'agent-1' });
    const agenda = crearGrafo('soy la agenda');
    const ventas = crearGrafo('soy el de ventas');
    const service = new ConversationService(prisma, agenda, ventas as never);

    expect(await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola')).toBe('soy la agenda');
    expect(ventas.invoke).not.toHaveBeenCalled();
  });
});
