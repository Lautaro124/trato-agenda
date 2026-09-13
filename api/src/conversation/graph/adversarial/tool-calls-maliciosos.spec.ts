import { AIMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { correr, crearCalendar, crearModelo, crearPrisma, hora, llamada, llamadas } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tool calls maliciosos o mal formados (matriz C)', () => {
  it('C-001: nombre de acción inexistente se rechaza sin ejecutar nada', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([llamada('borrar_base', {}), new AIMessage('No puedo hacer eso.')]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(calendarService.cancelarEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('no está habilitada');
  });

  it('C-003: crear_turno sin el campo inicio se rechaza por schema', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', fin: hora('10:30') }),
      new AIMessage('Falta un dato.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('no son válidos');
  });

  it('C-004: inicio con tipo erróneo (número en vez de string) se rechaza por schema', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamada('crear_turno', { nombreCliente: 'Juan', resumen: 'Corte', inicio: 1234567890, fin: hora('10:30') }),
      new AIMessage('Formato inválido.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('no son válidos');
  });

  it('C-006: tool_call_id duplicado en un mismo AIMessage: ambas llamadas se procesan (no se deduplican por id)', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([
      llamadas(
        { id: 'call-1', name: 'consultar_turno', args: {} },
        { id: 'call-1', name: 'consultar_turno', args: {} },
      ),
      new AIMessage('Listo.'),
    ]);

    const resultado = await correr({ prisma, calendarService, llm, }, { esPropietario: false });

    const respuestasTool = resultado.messages.filter((m) => m.getType() === 'tool');
    expect(respuestasTool).toHaveLength(2);
    expect(respuestasTool.every((m) => (m as { tool_call_id?: string }).tool_call_id === 'call-1')).toBe(true);
  });

  it('C-008: repetir cancelar_turno dos veces en el mismo mensaje no cancela el evento dos veces', async () => {
    const prisma = crearPrisma({ turnoActivo: { id: 'turno-1', googleEventId: 'evento-abc', nombreCliente: 'Juan', inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')), estado: 'confirmado', createdAt: new Date() } as never });
    const calendarService = crearCalendar([{ inicio: new Date(hora('10:00')), fin: new Date(hora('10:30')) }]);
    const llm = crearModelo([
      llamadas({ name: 'cancelar_turno', args: {} }, { name: 'cancelar_turno', args: {} }),
      new AIMessage('Cancelado.'),
    ]);

    await correr({ prisma, calendarService, llm });

    // La validación procesa ambas tool calls contra el mismo snapshot (turnoActivo
    // sigue siendo el mismo durante la validación), así que las dos llegan como
    // "pendiente" a `calendar`; ahí sí sólo la primera encuentra turnoActivo en
    // el estado real que se va actualizando operación por operación.
    expect(calendarService.cancelarEvento).toHaveBeenCalledTimes(1);
  });

  it('C-009: un AIMessage con content vacío y sin tool_calls no reintenta conversacion', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([new AIMessage('')]);

    await correr({ prisma, calendarService, llm });

    expect(llm.invoke).toHaveBeenCalledTimes(1);
  });

  it('C-010: un bucle de tool calls inválidas corta en el límite de recursión, no cuelga', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    let numero = 0;
    const modeloQueSiempreLlama = {
      invoke: vi.fn(async () => llamada('accion_inventada', {}, `call-${numero++}`)),
      bindTools: function (this: unknown) { return this; },
    };
    modeloQueSiempreLlama.bindTools = modeloQueSiempreLlama.bindTools.bind(modeloQueSiempreLlama);

    await expect(correr({ prisma, calendarService, llm: modeloQueSiempreLlama as never })).rejects.toThrow();
  });

  it('C-016: el modelo afirma "reservado" en texto sin tool call: no se escribe nada real', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const llm = crearModelo([new AIMessage('Listo, ya te lo reservé para mañana a las 10.')]);

    await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    expect(prisma.turno.create).not.toHaveBeenCalled();
  });

  it('C-017: cancelar_evento_calendario con confirmado=true sin haber listado antes se ejecuta igual (hueco de defensa en profundidad)', async () => {
    const prisma = crearPrisma();
    const calendarService = {
      ...crearCalendar(),
      eliminarEventoDesdeAgenda: vi.fn().mockResolvedValue(undefined),
    } as never;
    const llm = crearModelo([
      llamada('cancelar_evento_calendario', { eventoId: 'evento-x', confirmado: true }),
      new AIMessage('Cancelado.'),
    ]);

    await correr({ prisma, calendarService, llm }, { esPropietario: true });

    // Documenta el comportamiento real: el flujo "listar antes de confirmar" es
    // sólo una instrucción del prompt, no una invariante del código de validación.
    expect((calendarService as { eliminarEventoDesdeAgenda: ReturnType<typeof vi.fn> }).eliminarEventoDesdeAgenda).toHaveBeenCalled();
  });

  it('C-019: content no vacío junto con tool_calls igual dispara la ejecución de las tool_calls', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    const conTexto = new AIMessage({ content: 'Dale, ya lo hago.', tool_calls: [{ id: 'call-1', name: 'consultar_turno', args: {} }] });
    const llm = crearModelo([conTexto, new AIMessage('Listo.')]);

    await correr({ prisma, calendarService, llm });

    expect(prisma.turno.findMany).toHaveBeenCalled();
  });

  it('RL2-002: argumentos de tool call truncados (JSON a medias simulado como valor parcial) no ejecutan nada', async () => {
    const prisma = crearPrisma();
    const calendarService = crearCalendar();
    // Simula lo que produciría un parseo de tool-call-args cortado a mitad de
    // camino: un objeto con sólo una parte de los campos esperados.
    const llm = crearModelo([llamada('crear_turno', { nombreCliente: 'Juan' }), new AIMessage('Faltan datos.')]);

    const resultado = await correr({ prisma, calendarService, llm });

    expect(calendarService.crearEvento).not.toHaveBeenCalled();
    const rechazo = resultado.messages.find((m) => m.getType() === 'tool');
    expect(rechazo?.content).toContain('no son válidos');
  });
});
