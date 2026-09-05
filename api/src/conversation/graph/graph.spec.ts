import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { CalendarService, PeriodoOcupado } from '../../calendar/calendar.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { LIMITE_RECURSION, construirGrafo } from './graph.factory.js';

/** Los tests trabajan en -03:00, la zona fija del proyecto. */
function hora(iso: string, dia = '2026-09-01'): string {
  return `${dia}T${iso}:00-03:00`;
}

const AGENT = {
  id: 'agent-1',
  userId: 'user-1',
  allowedActions: ['consultar_disponibilidad', 'crear_turno', 'reprogramar_turno', 'cancelar_turno'],
  systemPrompt: 'Sos Tati.',
  tipoTitular: 'negocio',
  nombreTitular: 'Tienda Centro',
  nombreBot: 'Tati',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [{ nombre: 'Corte de pelo', duracionMin: 30 }],
  user: { id: 'user-1', googleRefreshToken: 'cifrado' },
};

const CONVERSATION = {
  id: 'conv-1',
  userId: 'user-1',
  remoteJid: '54911@s.whatsapp.net',
  resumen: null,
  nombreCliente: null,
};

const TURNO = {
  id: 'turno-1',
  googleEventId: 'evento-abc',
  inicio: new Date(hora('10:00')),
  fin: new Date(hora('10:30')),
};

function crearPrisma(opciones: { turnoActivo?: typeof TURNO | null } = {}) {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(AGENT) },
    conversation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(CONVERSATION),
      update: vi.fn().mockResolvedValue({ ...CONVERSATION, nombreCliente: 'Juan' }),
    },
    turno: {
      findFirst: vi.fn().mockResolvedValue(opciones.turnoActivo ?? null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'turno-nuevo', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...TURNO, ...data })),
    },
    message: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;
}

function crearCalendar(ocupados: PeriodoOcupado[] = []) {
  return {
    freeBusy: vi.fn().mockResolvedValue(ocupados),
    crearEvento: vi.fn().mockResolvedValue('evento-nuevo'),
    cancelarEvento: vi.fn().mockResolvedValue(undefined),
    reprogramarEvento: vi.fn().mockResolvedValue(undefined),
    listarProximos: vi.fn().mockResolvedValue([]),
  } as unknown as CalendarService;
}

/** Modelo falso: devuelve las respuestas preparadas, una por vuelta. */
function crearModelo(respuestas: BaseMessage[]) {
  const invoke = vi.fn(async () => respuestas[Math.min(invoke.mock.calls.length - 1, respuestas.length - 1)]);
  const modelo = { invoke, bindTools: () => modelo };
  return modelo as unknown as BaseChatModel & { invoke: typeof invoke };
}

function llamada(name: string, args: Record<string, unknown>) {
  return new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name, args }] });
}

function correr(deps: {
  prisma: PrismaService;
  calendarService: CalendarService;
  llm: BaseChatModel;
}) {
  const grafo = construirGrafo({
    ...deps,
    openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
    checkpointer: new MemorySaver(),
  });
  return grafo.invoke(
    {
      messages: [new HumanMessage('hola, quiero un turno')],
      ownerUserId: 'user-1',
      remoteJid: CONVERSATION.remoteJid,
      esPropietario: false,
    },
    { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('grafo conversacional', () => {
  it('sin tool calls responde el texto del modelo y espeja los mensajes', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([new AIMessage('Hola, soy Tati.')]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(resultado.messages.at(-1)?.content).toBe('Hola, soy Tati.');
    expect(llm.invoke).toHaveBeenCalledTimes(1);
    // El humano y la respuesta del agente.
    expect(prisma.message.create).toHaveBeenCalledTimes(2);
  });

  it('lee la agenda una sola vez por mensaje entrante', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('consultar_disponibilidad', { desde: hora('10:00'), hasta: hora('11:00') }),
      new AIMessage('Tengo libre a las 10.'),
    ]);

    await correr({ prisma, calendarService, llm });

    // La disponibilidad se resuelve contra el snapshot: sin lecturas extra.
    expect(calendarService.freeBusy).toHaveBeenCalledTimes(1);
    expect(llm.invoke).toHaveBeenCalledTimes(2);
  });

  it('agenda un turno válido y lo registra', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('10:00'),
        fin: hora('10:30'),
      }),
      new AIMessage('Listo Juan, te esperamos.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).toHaveBeenCalledWith(
      AGENT.user,
      expect.objectContaining({ resumen: 'Corte - Juan' }),
    );
    expect(prisma.turno.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nombreCliente: 'Juan' }) }),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'conv-1' }, data: { nombreCliente: 'Juan' } }),
    );
    expect(calendarService.freeBusy).toHaveBeenCalledTimes(1);
  });

  it('rechaza un horario fuera de la franja sin tocar Google', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('20:00'),
        fin: hora('20:30'),
      }),
      new AIMessage('Ese horario no lo tengo, ¿te sirve a las 10?'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(prisma.turno.create).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((mensaje) => mensaje.getType() === 'tool');
    expect(rechazo?.content).toContain('fuera de la franja');
  });

  it('rechaza un turno pegado a otro por el margen de 5 minutos', async () => {
    const prisma = crearPrisma();
    // Turno anterior de 09:30 a 10:00: a 3 minutos del nuevo, cae dentro del margen.
    const calendarService = crearCalendar([
      { inicio: new Date(hora('09:30')), fin: new Date(hora('10:00')) },
    ]);
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('10:03'),
        fin: hora('10:33'),
      }),
      new AIMessage('Ese horario está tomado.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((mensaje) => mensaje.getType() === 'tool');
    expect(rechazo?.content).toContain('No se pudo agendar');
  });

  it('sin nombre del cliente no agenda y pide el nombre', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: '  ', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('¿A nombre de quién lo agendo?'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((mensaje) => mensaje.getType() === 'tool');
    expect(rechazo?.content).toContain('nombre');
  });

  it('reprogramar no choca contra el propio evento del turno', async () => {
    const prisma = crearPrisma({ turnoActivo: TURNO });
    const calendarService = crearCalendar([{ inicio: TURNO.inicio, fin: TURNO.fin }]);
    const llm = crearModelo([
      llamada('reprogramar_turno', { inicio: hora('10:10'), fin: hora('10:40') }),
      new AIMessage('Listo, lo moví.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.reprogramarEvento).toHaveBeenCalled();
    expect(prisma.turno.update).toHaveBeenCalled();
  });

  it('reprogramar sí choca contra un evento ajeno dentro del margen', async () => {
    const prisma = crearPrisma({ turnoActivo: TURNO });
    const calendarService = crearCalendar([
      { inicio: TURNO.inicio, fin: TURNO.fin },
      { inicio: new Date(hora('10:42')), fin: new Date(hora('11:00')) },
    ]);
    const llm = crearModelo([
      llamada('reprogramar_turno', { inicio: hora('10:10'), fin: hora('10:40') }),
      new AIMessage('Ese horario no me sirve.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.reprogramarEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((mensaje) => mensaje.getType() === 'tool');
    expect(rechazo?.content).toContain('No se pudo reprogramar');
  });

  it('no ejecuta una acción que el agente no tiene habilitada', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('consultar_turno', {}),
      new AIMessage('No puedo consultarlo.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(prisma.turno.findMany).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((mensaje) => mensaje.getType() === 'tool');
    expect(rechazo?.content).toContain('no está habilitada');
  });

  it('con la agenda de Google caída no agenda nada', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    (calendarService.freeBusy as ReturnType<typeof vi.fn>).mockRejectedValue(
      new (await import('../../calendar/google-calendar.client.js')).CalendarUnavailableError('sin token'),
    );
    const llm = crearModelo([
      llamada('crear_turno', {
        nombreCliente: 'Juan',
        resumen: 'Corte',
        inicio: hora('10:00'),
        fin: hora('10:30'),
      }),
      new AIMessage('Perdón, estamos con un problema.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((mensaje) => mensaje.getType() === 'tool');
    expect(rechazo?.content).toContain('No se pudo leer la agenda');
  });
});
