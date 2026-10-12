import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenRouterClient } from '../../agents/openrouter.client.js';
import type { CalendarService, ResultadoInscripcion } from '../../calendar/calendar.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { LIMITE_RECURSION, construirGrafo } from './graph.factory.js';

/** El 1/9/2026 es martes; los tests trabajan en -03:00, la zona fija del proyecto. */
function hora(hhmm: string, dia = '2026-09-01'): string {
  return `${dia}T${hhmm}:00-03:00`;
}

/** Yoga es grupal (2 lugares) los martes 12:00 —dentro de la franja— y los jueves 19:00 —fuera—. */
const AGENT = {
  id: 'agent-1',
  userId: 'user-1',
  allowedActions: ['consultar_disponibilidad', 'crear_turno', 'reprogramar_turno', 'cancelar_turno'],
  systemPrompt: 'Sos Tati.',
  tipoTitular: 'negocio',
  nombreTitular: 'Estudio Sol',
  nombreBot: 'Tati',
  horaDesde: '09:00',
  horaHasta: '18:00',
  tiposEvento: [
    { nombre: 'Masaje', duracionMin: 30 },
    {
      nombre: 'Yoga',
      duracionMin: 60,
      capacidad: 2,
      horarios: [
        { dia: 'mar', hora: '12:00' },
        { dia: 'jue', hora: '19:00' },
      ],
    },
  ],
  user: { id: 'user-1', calendario: 'local', googleRefreshToken: null },
};

const CONVERSATION = {
  id: 'conv-1',
  userId: 'user-1',
  remoteJid: '54911@s.whatsapp.net',
  resumen: null,
  nombreCliente: 'Juan',
};

const CLASE_MARTES = { inicio: new Date(hora('12:00')), fin: new Date(hora('13:00')) };

/** Un anotado de otra conversación en la clase del martes. */
function anotado(conversationId: string) {
  return { ...CLASE_MARTES, nombreCliente: 'Otra', tipo: 'Yoga', conversationId };
}

type TurnoActivo = { id: string; googleEventId: string; tipo: string | null; nombreCliente: string; inicio: Date; fin: Date };

function crearPrisma(opciones: { anotados?: ReturnType<typeof anotado>[]; turnoActivo?: TurnoActivo | null } = {}) {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(AGENT) },
    conversation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(CONVERSATION),
      update: vi.fn().mockResolvedValue(CONVERSATION),
    },
    turno: {
      findFirst: vi.fn().mockResolvedValue(opciones.turnoActivo ?? null),
      findMany: vi.fn().mockResolvedValue(opciones.anotados ?? []),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'turno-nuevo', ...data })),
      update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'turno-1', ...data })),
    },
    message: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;
}

function crearCalendar(inscripcion?: ResultadoInscripcion) {
  return {
    freeBusy: vi.fn().mockResolvedValue([]),
    crearEvento: vi.fn().mockResolvedValue('evento-nuevo'),
    cancelarEvento: vi.fn().mockResolvedValue(undefined),
    reprogramarEvento: vi.fn().mockResolvedValue(undefined),
    listarProximos: vi.fn().mockResolvedValue([]),
    listarTurnos: vi.fn().mockResolvedValue([]),
    inscribirEnTurnoGrupal: vi.fn().mockImplementation((_user, datos) =>
      Promise.resolve(
        inscripcion ?? {
          ok: true,
          anotados: 1,
          turno: { id: 'turno-nuevo', googleEventId: 'evento-clase', estado: 'confirmado', ...datos },
        },
      ),
    ),
    bajaDeTurnoGrupal: vi.fn().mockResolvedValue(0),
  } as unknown as CalendarService;
}

function crearModelo(respuestas: BaseMessage[]) {
  const invoke = vi.fn(async () => respuestas[Math.min(invoke.mock.calls.length - 1, respuestas.length - 1)]);
  const modelo = { invoke, bindTools: () => modelo };
  return modelo as unknown as BaseChatModel & { invoke: typeof invoke };
}

function llamadas(...calls: { name: string; args: Record<string, unknown> }[]) {
  return new AIMessage({
    content: '',
    tool_calls: calls.map((call, indice) => ({ id: `call-${indice}`, name: call.name, args: call.args })),
  });
}

async function correr(deps: { prisma: PrismaService; calendarService: CalendarService; llm: BaseChatModel }) {
  const grafo = construirGrafo({
    ...deps,
    openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
    checkpointer: new MemorySaver(),
  });
  return grafo.invoke(
    {
      messages: [new HumanMessage('quiero ir a yoga')],
      ownerUserId: 'user-1',
      remoteJid: CONVERSATION.remoteJid,
      esPropietario: false,
    },
    { configurable: { thread_id: CONVERSATION.id }, recursionLimit: LIMITE_RECURSION },
  );
}

function respuestasDeHerramientas(mensajes: BaseMessage[]): string[] {
  return mensajes.filter((mensaje) => mensaje instanceof ToolMessage).map((mensaje) => String(mensaje.content));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('turnos grupales en el grafo de agenda', () => {
  it('le muestra al modelo las próximas clases con sus lugares, sin nombres de otros clientes', async () => {
    const llm = crearModelo([new AIMessage('¡Hola!')]);

    await correr({ prisma: crearPrisma({ anotados: [anotado('conv-2')] }), calendarService: crearCalendar(), llm });

    const [mensajes] = llm.invoke.mock.calls[0] as unknown as [BaseMessage[]];
    const sistema = String(mensajes[0].content);
    expect(sistema).toContain('grupal de hasta 2 personas');
    expect(sistema).toContain('sólo se dan en sus horarios fijos');
    // El separador del día depende de la versión de ICU ("1/9" o "1-9").
    expect(sistema).toMatch(/- Yoga: martes 1[/-]9 12:00 \(queda 1 lugar de 2\) · jueves 3[/-]9 19:00 \(quedan 2 lugares de 2\)/);
    expect(sistema).not.toContain('Otra');
  });

  it('la clase ocupa la agenda: la disponibilidad del martes no ofrece ese rato', async () => {
    const llm = crearModelo([new AIMessage('¡Hola!')]);

    await correr({ prisma: crearPrisma(), calendarService: crearCalendar(), llm });

    const [mensajes] = llm.invoke.mock.calls[0] as unknown as [BaseMessage[]];
    expect(String(mensajes[0].content)).toMatch(/martes 1[/-]9: 09:00-11:55, 13:05-18:00/);
  });

  it('anota en la clase con el fin de la clase, sin releer Google ni crear un evento suelto', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      // El modelo calcula mal el fin: manda el de la clase igual.
      llamadas({ name: 'crear_turno', args: { nombreCliente: 'Juan', resumen: 'yoga', inicio: hora('12:00'), fin: hora('12:30') } }),
      new AIMessage('Listo Juan, te anoté.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.inscribirEnTurnoGrupal).toHaveBeenCalledWith(AGENT.user, {
      conversationId: 'conv-1',
      nombreCliente: 'Juan',
      tipo: 'Yoga',
      ...CLASE_MARTES,
      capacidad: 2,
    });
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(calendarService.freeBusy).toHaveBeenCalledTimes(1);
    expect(respuestasDeHerramientas(resultado.messages)[0]).toMatch(/^Anotado Juan en la clase de Yoga/);
  });

  it('una clase fuera de la franja de atención se puede reservar igual: el horario es del dueño', async () => {
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamadas({ name: 'crear_turno', args: { nombreCliente: 'Juan', resumen: 'Yoga', inicio: hora('19:00', '2026-09-03'), fin: hora('20:00', '2026-09-03') } }),
      new AIMessage('Listo.'),
    ]);

    await correr({ prisma: crearPrisma(), calendarService, llm });

    expect(calendarService.inscribirEnTurnoGrupal).toHaveBeenCalledTimes(1);
  });

  it('rechaza un horario que no es de una clase y sugiere las que tienen lugar', async () => {
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamadas({ name: 'crear_turno', args: { nombreCliente: 'Juan', resumen: 'Yoga', inicio: hora('15:00'), fin: hora('16:00') } }),
      new AIMessage('Ese horario no hay.'),
    ]);

    const resultado = await correr({ prisma: crearPrisma(), calendarService, llm });

    const [texto] = respuestasDeHerramientas(resultado.messages);
    expect(texto).toMatch(/^No se pudo anotar: Yoga es un turno grupal/);
    expect(texto).toMatch(/martes 1[/-]9 12:00 \(quedan 2 lugares de 2\)/);
    expect(calendarService.inscribirEnTurnoGrupal).not.toHaveBeenCalled();
  });

  it('rechaza una clase completa y ofrece la siguiente con lugar', async () => {
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamadas({ name: 'crear_turno', args: { nombreCliente: 'Juan', resumen: 'Yoga', inicio: hora('12:00'), fin: hora('13:00') } }),
      new AIMessage('Esa está llena.'),
    ]);

    const resultado = await correr({
      prisma: crearPrisma({ anotados: [anotado('conv-2'), anotado('conv-3')] }),
      calendarService,
      llm,
    });

    const [texto] = respuestasDeHerramientas(resultado.messages);
    expect(texto).toContain('está completa (2 de 2 lugares)');
    expect(texto).toMatch(/Las próximas con lugar: jueves 3[/-]9 19:00/);
    expect(calendarService.inscribirEnTurnoGrupal).not.toHaveBeenCalled();
  });

  it('no anota dos veces a la misma conversación en la misma clase, ni en el mismo mensaje', async () => {
    const calendarService = crearCalendar();
    const args = { nombreCliente: 'Juan', resumen: 'Yoga', inicio: hora('12:00'), fin: hora('13:00') };
    const llm = crearModelo([
      llamadas({ name: 'crear_turno', args }, { name: 'crear_turno', args }),
      new AIMessage('Listo.'),
    ]);

    const resultado = await correr({ prisma: crearPrisma(), calendarService, llm });

    expect(calendarService.inscribirEnTurnoGrupal).toHaveBeenCalledTimes(1);
    expect(respuestasDeHerramientas(resultado.messages)).toContainEqual(expect.stringContaining('Ya está anotado'));
  });

  it('si la clase se llenó entre el snapshot y la escritura, avisa en vez de anotar', async () => {
    const calendarService = crearCalendar({ ok: false, motivo: 'completa' });
    const llm = crearModelo([
      llamadas({ name: 'crear_turno', args: { nombreCliente: 'Juan', resumen: 'Yoga', inicio: hora('12:00'), fin: hora('13:00') } }),
      new AIMessage('Uh, se llenó.'),
    ]);

    const resultado = await correr({ prisma: crearPrisma(), calendarService, llm });

    expect(respuestasDeHerramientas(resultado.messages)[0]).toMatch(/^No se pudo anotar: se llenó recién/);
  });

  it('un turno individual no puede caer encima de una clase', async () => {
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamadas({ name: 'crear_turno', args: { nombreCliente: 'Juan', resumen: 'Masaje', inicio: hora('12:15'), fin: hora('12:45') } }),
      new AIMessage('Ese horario no.'),
    ]);

    const resultado = await correr({ prisma: crearPrisma(), calendarService, llm });

    expect(respuestasDeHerramientas(resultado.messages)[0]).toContain('Ese horario está ocupado');
    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(calendarService.inscribirEnTurnoGrupal).not.toHaveBeenCalled();
  });

  it('cancelar un turno grupal da de baja sólo ese lugar', async () => {
    const turnoActivo = { id: 'turno-1', googleEventId: 'evento-clase', tipo: 'Yoga', nombreCliente: 'Juan', ...CLASE_MARTES };
    const calendarService = crearCalendar();
    const llm = crearModelo([llamadas({ name: 'cancelar_turno', args: {} }), new AIMessage('Listo, cancelado.')]);

    await correr({ prisma: crearPrisma({ anotados: [{ ...anotado('conv-1') }], turnoActivo }), calendarService, llm });

    expect(calendarService.bajaDeTurnoGrupal).toHaveBeenCalledWith(AGENT.user, turnoActivo, 2);
    expect(calendarService.cancelarEvento).not.toHaveBeenCalled();
  });

  it('reprogramar un turno grupal anota en la otra clase y después libera la vieja', async () => {
    const turnoActivo = { id: 'turno-1', googleEventId: 'evento-clase', tipo: 'Yoga', nombreCliente: 'Juan', ...CLASE_MARTES };
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamadas({ name: 'reprogramar_turno', args: { inicio: hora('19:00', '2026-09-03'), fin: hora('20:00', '2026-09-03') } }),
      new AIMessage('Listo, te pasé al jueves.'),
    ]);

    const resultado = await correr({ prisma: crearPrisma({ anotados: [anotado('conv-1')], turnoActivo }), calendarService, llm });

    expect(calendarService.inscribirEnTurnoGrupal).toHaveBeenCalledWith(
      AGENT.user,
      expect.objectContaining({ tipo: 'Yoga', inicio: new Date(hora('19:00', '2026-09-03')) }),
    );
    expect(calendarService.bajaDeTurnoGrupal).toHaveBeenCalledWith(AGENT.user, turnoActivo, 2);
    const inscripcion = vi.mocked(calendarService.inscribirEnTurnoGrupal).mock.invocationCallOrder[0];
    const baja = vi.mocked(calendarService.bajaDeTurnoGrupal).mock.invocationCallOrder[0];
    expect(inscripcion).toBeLessThan(baja);
    expect(calendarService.reprogramarEvento).not.toHaveBeenCalled();
    expect(respuestasDeHerramientas(resultado.messages)[0]).toMatch(/^Turno reprogramado para la clase de Yoga/);
  });

  it('si la clase nueva está llena, reprogramar no suelta el lugar que tenía', async () => {
    const turnoActivo = { id: 'turno-1', googleEventId: 'evento-clase', tipo: 'Yoga', nombreCliente: 'Juan', ...CLASE_MARTES };
    const calendarService = crearCalendar({ ok: false, motivo: 'completa' });
    const llm = crearModelo([
      llamadas({ name: 'reprogramar_turno', args: { inicio: hora('19:00', '2026-09-03'), fin: hora('20:00', '2026-09-03') } }),
      new AIMessage('Esa está llena.'),
    ]);

    await correr({ prisma: crearPrisma({ anotados: [anotado('conv-1')], turnoActivo }), calendarService, llm });

    expect(calendarService.bajaDeTurnoGrupal).not.toHaveBeenCalled();
  });

  it('la consulta de un día suma las clases con lugar de ese día', async () => {
    const llm = crearModelo([
      llamadas({ name: 'consultar_disponibilidad', args: { desde: hora('00:00'), hasta: hora('23:59') } }),
      new AIMessage('El martes tengo...'),
    ]);

    const resultado = await correr({ prisma: crearPrisma(), calendarService: crearCalendar(), llm });

    expect(respuestasDeHerramientas(resultado.messages)[0]).toContain(
      'Ese día también hay clases grupales: Yoga a las 12:00 (quedan 2 lugares de 2).',
    );
  });
});
