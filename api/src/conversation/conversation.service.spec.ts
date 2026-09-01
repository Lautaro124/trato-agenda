import { describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../agents/openrouter.client.js';
import type { CalendarService } from '../calendar/calendar.service.js';
import { CalendarUnavailableError } from '../calendar/google-calendar.client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ConversationService } from './conversation.service.js';

function crearPrisma() {
  return {
    agent: { findUnique: vi.fn() },
    conversation: { upsert: vi.fn().mockResolvedValue({ id: 'conv-1' }) },
    message: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    turno: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

const USUARIO = { id: 'user-1', googleRefreshToken: 'cifrado' };

describe('ConversationService.handleIncoming', () => {
  it('sin Agent configurado, responde sin llamar a OpenRouter ni crear conversación', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const chat = vi.fn();
    const service = new ConversationService(
      prisma,
      { chat } as unknown as OpenRouterClient,
      {} as unknown as CalendarService,
    );

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    expect(respuesta).toContain('no está configurado');
    expect(chat).not.toHaveBeenCalled();
    expect(prisma.conversation.upsert).not.toHaveBeenCalled();
  });

  it('una vuelta sin tool_calls devuelve el texto del modelo directo', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      allowedActions: [],
      systemPrompt: 'Sos el agente de una tienda.',
      user: USUARIO,
    });
    const chat = vi.fn().mockResolvedValue({ content: 'Hola! ¿En qué te ayudo?' });
    const service = new ConversationService(
      prisma,
      { chat } as unknown as OpenRouterClient,
      {} as unknown as CalendarService,
    );

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    expect(respuesta).toBe('Hola! ¿En qué te ayudo?');
    expect(chat).toHaveBeenCalledTimes(1);
    expect(prisma.message.create).toHaveBeenCalledTimes(2); // user + assistant
  });

  it('ejecuta crear_turno y agenda el evento cuando el modelo pide el tool', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      allowedActions: ['crear_turno'],
      systemPrompt: 'Sos el agente de una tienda.',
      user: USUARIO,
    });

    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: {
              name: 'crear_turno',
              arguments: JSON.stringify({
                resumen: 'Corte de pelo',
                inicio: '2026-09-01T10:00:00-03:00',
                fin: '2026-09-01T10:30:00-03:00',
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Listo, te agendé el turno.' });

    const calendarService = {
      freeBusy: vi.fn().mockResolvedValue([]),
      crearEvento: vi.fn().mockResolvedValue('evento-abc'),
    } as unknown as CalendarService;

    const service = new ConversationService(prisma, { chat } as unknown as OpenRouterClient, calendarService);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'quiero un turno');

    expect(respuesta).toBe('Listo, te agendé el turno.');
    expect(chat).toHaveBeenCalledTimes(2);
    expect(calendarService.crearEvento).toHaveBeenCalledWith(
      USUARIO,
      expect.objectContaining({ resumen: 'Corte de pelo' }),
    );
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ conversationId: 'conv-1', googleEventId: 'evento-abc' }) }),
    );
  });

  it('si Calendar no está disponible, el tool devuelve una disculpa en vez de romper el loop', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      allowedActions: ['crear_turno'],
      systemPrompt: 'Sos el agente de una tienda.',
      user: USUARIO,
    });

    const chat = vi
      .fn()
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function' as const,
            function: {
              name: 'crear_turno',
              arguments: JSON.stringify({
                resumen: 'Corte de pelo',
                inicio: '2026-09-01T10:00:00-03:00',
                fin: '2026-09-01T10:30:00-03:00',
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Uy, hubo un problema con la agenda, ya le aviso al dueño.' });

    const calendarService = {
      freeBusy: vi.fn().mockRejectedValue(new CalendarUnavailableError('token revocado')),
      crearEvento: vi.fn(),
    } as unknown as CalendarService;

    const service = new ConversationService(prisma, { chat } as unknown as OpenRouterClient, calendarService);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'quiero un turno');

    expect(respuesta).toBe('Uy, hubo un problema con la agenda, ya le aviso al dueño.');
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(prisma.turno.create).not.toHaveBeenCalled();
  });
});
