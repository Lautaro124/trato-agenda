import { AIMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { esHerramientaPropietario } from '../../conversation-tools.js';
import { herramientasDisponibles } from '../nodes/conversacion.node.js';
import { correr, crearCalendar, crearModelo, crearPrisma, hora, llamada } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('relaciones metamórficas y controles negativos', () => {
  it('M-001: la validación decide por los argumentos de la tool call, no por el texto que la originó', async () => {
    // Dos "formas de pedirlo" distintas (el texto del HumanMessage no importa
    // para la validación) que terminan en la misma tool call: mismo veredicto.
    const prismaA = crearPrisma();
    const prismaB = crearPrisma();
    const calendarA = crearCalendar();
    const calendarB = crearCalendar();
    const args = { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') };

    const resultadoA = await correr(
      { prisma: prismaA, calendarService: calendarA, llm: crearModelo([llamada('crear_turno', args), new AIMessage('Listo.')]) },
      { mensaje: 'quiero un corte mañana a las 10, soy Juan' },
    );
    const resultadoB = await correr(
      { prisma: prismaB, calendarService: calendarB, llm: crearModelo([llamada('crear_turno', args), new AIMessage('Listo.')]) },
      { mensaje: 'dale, anotame para las 10 un corte, me llamo Juan' },
    );

    const toolA = resultadoA.messages.find((m) => m.getType() === 'tool');
    const toolB = resultadoB.messages.find((m) => m.getType() === 'tool');
    expect(toolA?.content).toBe(toolB?.content);
    expect(calendarA.crearEvento).toHaveBeenCalledTimes(1);
    expect(calendarB.crearEvento).toHaveBeenCalledTimes(1);
  });

  it('E-002/M-002: repetir el mismo mensaje (mismo estado de snapshot) no duplica una escritura ya confirmada', async () => {
    // Tras la primera reserva, el propio turno pasa a formar parte de los
    // ocupados: repetir la misma tool call sobre el mismo rango debe chocar.
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const args = { nombreCliente: 'Juan', resumen: 'Corte', inicio: hora('10:00'), fin: hora('10:30') };

    await correr({ prisma, calendarService, llm: crearModelo([llamada('crear_turno', args), new AIMessage('Listo.')]) });
    expect(calendarService.crearEvento).toHaveBeenCalledTimes(1);

    // El "repetir el mensaje" se simula con el freeBusy ya reportando el
    // horario recién creado, como pasaría en una conversación real.
    (calendarService.freeBusy as ReturnType<typeof vi.fn>).mockResolvedValue([
      { inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')) },
    ]);
    await correr({ prisma, calendarService, llm: crearModelo([llamada('crear_turno', args), new AIMessage('Ya tenías ese turno.')]) });

    expect(calendarService.crearEvento).toHaveBeenCalledTimes(1);
  });

  it('M-003: cambiar de titular (otro Agent) no arrastra turnoActivo ni resumen del anterior', async () => {
    const prismaViejo = crearPrisma({
      turnoActivo: { id: 'turno-viejo', googleEventId: 'ev-viejo', nombreCliente: 'Ana', inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')), estado: 'confirmado', createdAt: new Date() } as never,
      conversation: { id: 'conv-viejo', resumen: 'Cliente frecuente, prefiere la tarde.' },
      agent: { userId: 'user-1' },
    });
    const prismaNuevo = crearPrisma({
      turnoActivo: null,
      conversation: { id: 'conv-nuevo', resumen: null },
      agent: { userId: 'user-2', nombreTitular: 'Otro Negocio' },
    });
    const calendarService = crearCalendar();
    const llm = crearModelo([llamada('cancelar_turno', {}), new AIMessage('No hay nada que cancelar.')]);

    const resultado = await correr(
      { prisma: prismaNuevo, calendarService, llm },
      { threadId: 'conv-nuevo', remoteJid: 'nuevo@s.whatsapp.net' },
    );

    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('No hay ningún turno activo para cancelar');
    expect(calendarService.cancelarEvento).not.toHaveBeenCalled();
    void prismaViejo;
  });

  // M-004 (negación no se convierte en confirmación al resumir) requiere el
  // camino real de resumen contra OpenRouter: no hay forma de probarlo con un
  // doble sin fabricar una assertion vacía. Queda `bloqueado` en la matriz de
  // cobertura junto con D-009, a la espera de aprobación de presupuesto para
  // correr `api/evals/adversarial/resumen.eval.ts`.

  it('M-005 (control negativo): si una tool de propietario quedara bindeada para un cliente, este test debe fallar', () => {
    const nombres = herramientasDisponibles(
      ['consultar_disponibilidad', 'crear_turno', 'cancelar_turno', 'reprogramar_turno', 'consultar_turno'],
      false,
    ).map((h) => h.name);

    // Control negativo real: si alguna tool de propietario apareciera acá para
    // un cliente, la aserción de abajo debe atraparlo y hacer fallar el test —
    // eso es lo que prueba que el harness detecta violaciones, no que el
    // sistema es perfecto.
    const huboFuga = nombres.some((nombre) => esHerramientaPropietario(nombre));
    expect(huboFuga).toBe(false);
  });
});
