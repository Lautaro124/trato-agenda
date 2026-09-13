import { AIMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { correr, crearCalendar, crearModelo, crearPrisma, hora, llamada } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('concurrencia e idempotencia (matriz E)', () => {
  it('E-001: dos crear_turno concurrentes al mismo horario, sincronizados con una barrera: sólo uno agenda', async () => {
    const prismaA = crearPrisma();
    const prismaB = crearPrisma();
    // Snapshot de ambos: libre. La relectura de último momento de quien escribe
    // segundo debe encontrar el hueco ya tomado por el primero.
    const calendarA = crearCalendar();
    const calendarB = crearCalendar();

    let liberarB: () => void;
    const barrera = new Promise<void>((resolve) => { liberarB = resolve; });
    (calendarB.crearEvento as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await barrera;
      return 'evento-b';
    });
    (calendarB.freeBusy as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // snapshot de B: libre
      .mockResolvedValue([{ inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')) }]); // relectura: ya ocupado por A

    const llmA = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Ana', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('Listo Ana.'),
    ]);
    const llmB = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Beto', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('Listo Beto.'),
    ]);

    const promesaB = correr({ prisma: prismaB, calendarService: calendarB, llm: llmB }, { threadId: 'conv-b', remoteJid: 'b@s.whatsapp.net' });
    const resultadoA = await correr({ prisma: prismaA, calendarService: calendarA, llm: llmA }, { threadId: 'conv-a', remoteJid: 'a@s.whatsapp.net' });
    liberarB!();
    await promesaB;

    expect(calendarA.crearEvento).toHaveBeenCalledTimes(1);
    const rechazoB = (await promesaB).messages.find((m) => m.getType() === 'tool');
    expect(rechazoB?.content).toContain('se ocupó recién');
    void resultadoA;
  });

  it('E-003: dos Conversation del mismo titular resuelven su propio turnoActivo por conversationId', async () => {
    const prismaA = crearPrisma({
      conversation: { id: 'conv-a' },
      turnoActivo: { id: 'turno-a', googleEventId: 'ev-a', nombreCliente: 'Ana', inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')), estado: 'confirmado', createdAt: new Date() } as never,
    });
    const calendarService = crearCalendar([{ inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')) }]);
    const llm = crearModelo([llamada('cancelar_turno', {}), new AIMessage('Cancelado.')]);

    await correr({ prisma: prismaA, calendarService, llm }, { threadId: 'conv-a', remoteJid: 'a@s.whatsapp.net' });

    expect(prismaA.turno.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ conversationId: 'conv-a' }) }),
    );
    expect(calendarService.cancelarEvento).toHaveBeenCalledWith(expect.anything(), 'ev-a');
  });

  it('E-004: la respuesta de Google se pierde tras escribir (hueco: no hay idempotency key en crearEvento)', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    (calendarService.crearEvento as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('ETIMEDOUT tras haber escrito en Google'));
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('Hubo un problema, ¿lo intentamos de nuevo?'),
    ]);

    await correr({ prisma, calendarService, llm });

    // Documentado: el código no tiene una clave de idempotencia para distinguir
    // "nunca escribió" de "escribió pero la respuesta se perdió". Un reintento
    // del cliente en este escenario podría crear un evento duplicado en Google.
    expect(prisma.turno.create).not.toHaveBeenCalled();
  });

  it('E-005: cancelar dos veces seguidas (dos mensajes) no duplica el efecto', async () => {
    // Doble con estado real: turno.findFirst deja de encontrar el turno una vez
    // que turno.update lo marca "cancelado", como haría la base de verdad.
    let turno: { id: string; googleEventId: string; nombreCliente: string; inicio: Date; fin: Date; estado: string } | null = {
      id: 'turno-1', googleEventId: 'evento-abc', nombreCliente: 'Juan', inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')), estado: 'confirmado',
    };
    const prisma = crearPrisma();
    (prisma.turno.findFirst as ReturnType<typeof vi.fn>).mockImplementation(() =>
      Promise.resolve(turno?.estado === 'confirmado' ? turno : null),
    );
    (prisma.turno.update as ReturnType<typeof vi.fn>).mockImplementation(({ data }: { data: Partial<NonNullable<typeof turno>> }) => {
      turno = { ...(turno as NonNullable<typeof turno>), ...data };
      return Promise.resolve(turno);
    });
    const calendarService = crearCalendar([{ inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')) }]);

    await correr({ prisma, calendarService, llm: crearModelo([llamada('cancelar_turno', {}), new AIMessage('Cancelado.')]) });
    await correr({ prisma, calendarService, llm: crearModelo([llamada('cancelar_turno', {}), new AIMessage('Ya estaba cancelado.')]) });

    expect(calendarService.cancelarEvento).toHaveBeenCalledTimes(1);
  });

  it('E-008: dos threads distintos no mezclan mensajes entre sí', async () => {
    const prismaA = crearPrisma({ conversation: { id: 'conv-a' } });
    const prismaB = crearPrisma({ conversation: { id: 'conv-b' } });
    const calendarService = crearCalendar();
    const llmA = crearModelo([new AIMessage('Hola, soy para A.')]);
    const llmB = crearModelo([new AIMessage('Hola, soy para B.')]);

    const [resultadoA, resultadoB] = await Promise.all([
      correr({ prisma: prismaA, calendarService, llm: llmA }, { threadId: 'conv-a', remoteJid: 'a@s.whatsapp.net' }),
      correr({ prisma: prismaB, calendarService, llm: llmB }, { threadId: 'conv-b', remoteJid: 'b@s.whatsapp.net' }),
    ]);

    expect(resultadoA.messages.at(-1)?.content).toBe('Hola, soy para A.');
    expect(resultadoB.messages.at(-1)?.content).toBe('Hola, soy para B.');
  });

  it('B-025: un evento cancelado externamente en Google no bloquea agendar de nuevo ese rango', async () => {
    const prisma = crearPrisma();
    // freeBusy ya no reporta el período: se borró a mano en Google.
    const calendarService = crearCalendar([]);
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') }),
      new AIMessage('Listo.'),
    ]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).toHaveBeenCalled();
  });
});
