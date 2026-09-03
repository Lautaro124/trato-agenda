import { describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../agents/openrouter.client.js';
import type { CalendarService } from '../calendar/calendar.service.js';
import { CalendarUnavailableError } from '../calendar/google-calendar.client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ConversationService, jidDePrueba } from './conversation.service.js';

function crearPrisma() {
  return {
    agent: { findUnique: vi.fn() },
    conversation: {
      upsert: vi.fn().mockResolvedValue({ id: 'conv-1', remoteJid: '54911@s.whatsapp.net', resumen: null }),
      update: vi.fn().mockResolvedValue({}),
    },
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

/** Config de agenda que el runtime lee de la fila Agent (franja, tipos, nombres). */
const AGENDA = {
  tipoTitular: 'negocio',
  nombreTitular: 'Tienda Centro',
  nombreBot: 'Tati',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [{ nombre: 'Corte de pelo', duracionMin: 30 }],
};

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
      ...AGENDA,
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
    expect(chat).toHaveBeenCalledTimes(2); // respuesta + actualización de resumen
    expect(prisma.message.create).toHaveBeenCalledTimes(2); // user + assistant
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1' } }),
    );
  });

  it('ejecuta crear_turno y agenda el evento cuando el modelo pide el tool', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      ...AGENDA,
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
                nombreCliente: 'Juan',
                resumen: 'Corte de pelo',
                inicio: '2026-09-01T10:00:00-03:00',
                fin: '2026-09-01T10:30:00-03:00',
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Listo, te agendé el turno.' })
      .mockResolvedValueOnce({ content: 'Cliente reservó un corte de pelo.' });

    const calendarService = {
      freeBusy: vi.fn().mockResolvedValue([]),
      crearEvento: vi.fn().mockResolvedValue('evento-abc'),
    } as unknown as CalendarService;

    const service = new ConversationService(prisma, { chat } as unknown as OpenRouterClient, calendarService);

    const respuesta = await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'quiero un turno');

    expect(respuesta).toBe('Listo, te agendé el turno.');
    expect(chat).toHaveBeenCalledTimes(3); // tool call + respuesta final + actualización de resumen
    expect(calendarService.crearEvento).toHaveBeenCalledWith(
      USUARIO,
      expect.objectContaining({ resumen: 'Corte de pelo - Juan' }),
    );
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conv-1',
          googleEventId: 'evento-abc',
          nombreCliente: 'Juan',
        }),
      }),
    );
  });

  it('si Calendar no está disponible, el tool devuelve una disculpa en vez de romper el loop', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      ...AGENDA,
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
                nombreCliente: 'Juan',
                resumen: 'Corte de pelo',
                inicio: '2026-09-01T10:00:00-03:00',
                fin: '2026-09-01T10:30:00-03:00',
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Uy, hubo un problema con la agenda, ya le aviso al dueño.' })
      .mockResolvedValueOnce({ content: 'Cliente tuvo un problema con la agenda.' });

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

  it('el dueño, desde el chat de prueba, puede cancelar cualquier evento aunque el agente no tenga esa acción habilitada', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      ...AGENDA,
      allowedActions: [], // el catálogo no incluye estas herramientas: no dependen de allowedActions
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
              name: 'listar_eventos_calendario',
              arguments: JSON.stringify({ desde: '2026-09-01T00:00:00-03:00', hasta: '2026-09-08T00:00:00-03:00' }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: 'call-2',
            type: 'function' as const,
            function: {
              name: 'cancelar_evento_calendario',
              arguments: JSON.stringify({ eventoId: 'evt-ajeno', confirmado: true }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ content: 'Listo, cancelé esa reunión.' });

    const calendarService = {
      listarProximos: vi.fn().mockResolvedValue([
        { id: 'evt-ajeno', resumen: 'Reunión con Ana', inicio: new Date('2026-09-03T15:00:00Z'), fin: new Date('2026-09-03T16:00:00Z') },
      ]),
      eliminarEventoDesdeAgenda: vi.fn().mockResolvedValue(undefined),
    } as unknown as CalendarService;

    const service = new ConversationService(prisma, { chat } as unknown as OpenRouterClient, calendarService);

    const respuesta = await service.handleIncoming('user-1', jidDePrueba('user-1'), 'cancelame la reunión con Ana');

    expect(respuesta).toBe('Listo, cancelé esa reunión.');
    expect(chat).toHaveBeenCalledTimes(3); // sin actualización de resumen: es el propio dueño
    expect(calendarService.eliminarEventoDesdeAgenda).toHaveBeenCalledWith(USUARIO, 'user-1', 'evt-ajeno');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('las herramientas de propietario no se ofrecen en una conversación real de WhatsApp', async () => {
    const prisma = crearPrisma();
    (prisma.agent.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'agent-1',
      ...AGENDA,
      allowedActions: ['crear_turno'],
      systemPrompt: 'Sos el agente de una tienda.',
      user: USUARIO,
    });
    const chat = vi.fn().mockResolvedValue({ content: 'Hola!' });
    const service = new ConversationService(
      prisma,
      { chat } as unknown as OpenRouterClient,
      {} as unknown as CalendarService,
    );

    await service.handleIncoming('user-1', '54911@s.whatsapp.net', 'hola');

    const toolsPasados = chat.mock.calls[0][0].tools as Array<{ function: { name: string } }> | undefined;
    const nombres = (toolsPasados ?? []).map((tool) => tool.function.name);
    expect(nombres).not.toContain('listar_eventos_calendario');
    expect(nombres).not.toContain('cancelar_evento_calendario');
    expect(nombres).not.toContain('editar_evento_calendario');
  });
});
