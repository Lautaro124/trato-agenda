import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AgentsService, construirDescripcion } from './agents.service.js';
import type { GenerateAgentDto } from './agents.types.js';
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

const dto: GenerateAgentDto = {
  tipoTitular: 'negocio',
  nombreTitular: 'Tienda Centro',
  tipoUso: 'comercio',
  tiposEvento: [
    { nombre: 'Probador', duracionMin: 20 },
    { nombre: 'Presupuesto', duracionMin: 30 },
  ],
  horaDesde: '09:00',
  horaHasta: '18:00',
  nombreBot: 'Tati',
};

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

  it('rechaza una franja horaria invertida sin llamar a OpenRouter', async () => {
    const chat = vi.fn();
    const { service, prisma } = crearServicio(chat);

    await expect(
      service.generate('user-1', { ...dto, horaDesde: '18:00', horaHasta: '09:00' }),
    ).rejects.toThrow();
    expect(chat).not.toHaveBeenCalled();
    expect(prisma.agent.upsert).not.toHaveBeenCalled();
  });

  it('persiste los campos del wizard y una descripción derivada de ellos', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['crear_turno'] }),
    });
    const { service, prisma } = crearServicio(chat);

    await service.generate('user-1', dto);

    expect(prisma.agent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          tipoTitular: 'negocio',
          nombreTitular: 'Tienda Centro',
          nombreBot: 'Tati',
          horaDesde: '09:00',
          horaHasta: '18:00',
          tiposEvento: dto.tiposEvento,
        }),
      }),
    );
  });
});

describe('META_SYSTEM_PROMPT', () => {
  it('le pide al meta-agente que acote el agente generado a la agenda', async () => {
    const chat = vi.fn().mockResolvedValue({
      content: JSON.stringify({ systemPrompt: 'ok', allowedActions: ['crear_turno'] }),
    });
    const { service } = crearServicio(chat);

    await service.generate('user-1', dto);

    const [{ messages }] = chat.mock.calls[0] as [{ messages: { role: string; content: string }[] }];
    const sistema = messages.find((mensaje) => mensaje.role === 'system')?.content ?? '';

    expect(sistema).toContain('hablar ÚNICAMENTE de la agenda del titular');
    expect(sistema).toContain('mezclado con un pedido de turno');
    expect(sistema).toContain('no inventar datos del negocio');
  });
});

describe('construirDescripcion', () => {
  it('incluye titular, tipos de evento con su duración y la franja horaria', () => {
    const descripcion = construirDescripcion(dto);

    expect(descripcion).toContain('Tienda Centro');
    expect(descripcion).toContain('Probador (20 min)');
    expect(descripcion).toContain('Presupuesto (30 min)');
    expect(descripcion).toContain('de 09:00 a 18:00');
  });
});
