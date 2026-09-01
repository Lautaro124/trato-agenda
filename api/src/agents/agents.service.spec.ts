import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AgentsService } from './agents.service.js';
import type { OpenRouterClient } from './openrouter.client.js';

function crearServicio(chatMock: ReturnType<typeof vi.fn>) {
  const prisma = {
    agent: { upsert: vi.fn().mockResolvedValue({ id: 'agent-1' }) },
  } as unknown as PrismaService;

  const openRouter = { chat: chatMock } as unknown as OpenRouterClient;

  const config = {
    get: (clave: string) => (clave === 'OPENROUTER_MODEL' ? 'openai/gpt-4o-mini' : 'x'),
  } as unknown as ConfigService<Env, true>;

  return { service: new AgentsService(prisma, openRouter, config), prisma };
}

const dto = { tipoUso: 'comercio' as const, descripcion: 'Turnos de 20 minutos para probarse ropa.' };

describe('AgentsService.generate', () => {
  it('persiste la config cuando OpenRouter devuelve un JSON válido de una', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        systemPrompt: 'Sos el agente de una tienda de ropa.',
        allowedActions: ['consultar_disponibilidad', 'crear_turno'],
      }),
    });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(chat).toHaveBeenCalledTimes(1);
    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1' },
        create: expect.objectContaining({
          userId: 'user-1',
          systemPrompt: 'Sos el agente de una tienda de ropa.',
          allowedActions: ['consultar_disponibilidad', 'crear_turno'],
          model: 'openai/gpt-4o-mini',
        }),
      }),
    );
  });

  it('reintenta una vez si el primer JSON es inválido y se recupera', async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: 'esto no es JSON' })
      .mockResolvedValueOnce({
        content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['crear_turno'] }),
      });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(chat).toHaveBeenCalledTimes(2);
    expect(prisma.agent.upsert).toHaveBeenCalledTimes(1);
  });

  it('tira BadGatewayException si falla dos veces seguidas', async () => {
    const chat = vi.fn().mockResolvedValue({ content: 'esto no es JSON' });
    const { service, prisma } = crearServicio(chat);

    await expect(service.generate('user-1', dto)).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(2);
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('rechaza una acción fuera del catálogo', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['mandar_flores'] }),
    });
    const { service, prisma } = crearServicio(chat);

    await expect(service.generate('user-1', dto)).rejects.toThrow();
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });
});
