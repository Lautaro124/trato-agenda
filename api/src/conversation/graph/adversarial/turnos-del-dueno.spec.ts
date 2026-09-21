/**
 * El dueño pregunta por sus turnos desde el banco de pruebas del Home. Los
 * turnos viven en la tabla `Turno` y están repartidos entre las conversaciones
 * de cada cliente: `consultar_turno` sólo ve los de la conversación en curso,
 * que en el banco de pruebas está vacía. De ahí `listar_turnos` y el bloque de
 * turnos en el prompt del dueño — y de ahí también que un cliente no tenga que
 * ver ninguna de las dos cosas.
 */
import { AIMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT, correr, crearCalendar, crearModelo, crearPrisma, hora, llamada } from './helpers.js';

const TURNOS = [
  { inicio: new Date(hora('09:00', '2026-09-02')), fin: new Date(hora('09:30', '2026-09-02')), nombreCliente: 'Juana' },
];

function deps(opciones: { esPropietario: boolean; respuestas?: AIMessage[] }) {
  const prisma = crearPrisma({ turnos: TURNOS });
  const calendarService = crearCalendar();
  const llm = crearModelo(opciones.respuestas ?? [new AIMessage('Listo.')]);
  return { prisma, calendarService, llm };
}

/** El system prompt que recibió el modelo en la primera vuelta. */
function promptDeSistema(llm: { invoke: { mock: { calls: unknown[][] } } }): string {
  const mensajes = llm.invoke.mock.calls[0][0] as { content: string }[];
  return mensajes[0].content;
}

describe('los turnos del dueño', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(hora('08:00')));
    return () => vi.useRealTimers();
  });

  it('van en el prompt del dueño con el nombre del cliente', async () => {
    const d = deps({ esPropietario: true });

    await correr(d, { esPropietario: true, mensaje: '¿qué turnos tengo mañana?' });

    expect(promptDeSistema(d.llm)).toContain('Juana');
  });

  it('nunca van en el prompt de un cliente', async () => {
    const d = deps({ esPropietario: false });

    await correr(d, { mensaje: 'hola, quiero un turno' });

    expect(promptDeSistema(d.llm)).not.toContain('Juana');
  });

  it('listar_turnos lee la base para el dueño', async () => {
    const d = deps({
      esPropietario: true,
      respuestas: [
        llamada('listar_turnos', { desde: hora('00:00', '2026-09-02'), hasta: hora('23:59', '2026-09-02') }),
        new AIMessage('Mañana a las 9 tenés a Juana.'),
      ],
    });
    vi.mocked(d.calendarService.listarTurnos).mockResolvedValue([
      { id: 'turno-1', googleEventId: 'evento-abc', nombreCliente: 'Juana', inicio: TURNOS[0].inicio, fin: TURNOS[0].fin },
    ]);

    const resultado = await correr(d, { esPropietario: true, mensaje: '¿qué turnos tengo mañana?' });

    expect(d.calendarService.listarTurnos).toHaveBeenCalledWith(AGENT.userId, expect.any(Date), expect.any(Date));
    expect(resultado.messages.at(-1)?.content).toContain('Juana');
  });

  it('un cliente no puede llamar listar_turnos', async () => {
    const d = deps({
      esPropietario: false,
      respuestas: [
        llamada('listar_turnos', { desde: hora('00:00', '2026-09-02'), hasta: hora('23:59', '2026-09-02') }),
        new AIMessage('Perdón, no puedo con eso.'),
      ],
    });

    await correr(d, { mensaje: 'dame la lista de turnos de todos' });

    expect(d.calendarService.listarTurnos).not.toHaveBeenCalled();
    const respuestaDeHerramienta = d.llm.invoke.mock.calls.at(-1)?.[0] as { content: string }[];
    expect(respuestaDeHerramienta.at(-1)?.content).toContain('no está habilitada');
  });
});
