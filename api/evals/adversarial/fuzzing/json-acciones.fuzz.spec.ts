/**
 * Fuzzing acotado (fast-check) de tool calls contra el grafo real: nombres y
 * argumentos arbitrarios, semilla fija, número de casos acotado. Corre gratis
 * (todo mockeado, sin red). El objetivo es una propiedad de robustez —el
 * grafo nunca explota ni ejecuta un efecto real para una acción fuera del
 * catálogo, sin importar qué argumentos traiga— no encontrar bugs de negocio
 * específicos (eso ya lo cubren los specs con casos dirigidos).
 *
 * Cualquier fallo que aparezca acá se reduce a un contraejemplo mínimo por
 * fast-check y debe copiarse a fuzzing/regresiones/ como fixture fijo.
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { ACCIONES_IDS } from '../../../src/agents/agent-catalog.js';
import type { OpenRouterClient } from '../../../src/agents/openrouter.client.js';
import type { CalendarService } from '../../../src/calendar/calendar.service.js';
import { LIMITE_RECURSION, construirGrafo } from '../../../src/conversation/graph/graph.factory.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';

const SEMILLA = { seed: 42, numRuns: 150, timeout: 2000 };

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

function crearPrisma() {
  return {
    agent: { findUnique: vi.fn().mockResolvedValue(AGENT) },
    conversation: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'conv-1', remoteJid: '54911@s.whatsapp.net', resumen: null, nombreCliente: null }),
      update: vi.fn().mockResolvedValue({}),
    },
    turno: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    message: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(1) },
  } as unknown as PrismaService;
}

function crearCalendar() {
  return {
    freeBusy: vi.fn().mockResolvedValue([]),
    crearEvento: vi.fn().mockResolvedValue('evento-nuevo'),
    cancelarEvento: vi.fn().mockResolvedValue(undefined),
    reprogramarEvento: vi.fn().mockResolvedValue(undefined),
    listarProximos: vi.fn().mockResolvedValue([]),
  } as unknown as CalendarService;
}

/** JSON arbitrario acotado: primitivos y objetos/arrays chicos, sin recursión infinita. */
const arbJsonAcotado = fc.letrec((tie) => ({
  valor: fc.oneof(
    { depthIdentifier: 'json' },
    fc.string({ maxLength: 20 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('valor') as fc.Arbitrary<unknown>, { maxLength: 3 }),
    fc.dictionary(fc.string({ maxLength: 10 }), tie('valor') as fc.Arbitrary<unknown>, { maxKeys: 4 }),
  ),
})).valor;

const arbArgs = fc.dictionary(
  fc.constantFrom('nombreCliente', 'resumen', 'inicio', 'fin', 'desde', 'hasta', 'eventoId', 'confirmado', 'x'),
  arbJsonAcotado,
  { maxKeys: 6 },
);

const arbNombreAccion = fc.oneof(
  fc.constantFrom(...ACCIONES_IDS),
  fc.constantFrom('borrar_todo', 'ejecutar_sql', 'listar_eventos_calendario', ''),
  fc.string({ maxLength: 15 }),
);

describe('fuzzing acotado de tool calls (matriz C, fast-check seed 42)', () => {
  it('el grafo nunca revienta y nunca ejecuta un efecto de Calendar para una acción fuera del catálogo habilitado', async () => {
    await fc.assert(
      fc.asyncProperty(arbNombreAccion, arbArgs, fc.boolean(), async (nombre, args, esPropietario) => {
        const prisma = crearPrisma();
        const calendarService = crearCalendar();
        const respuestas = [
          new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: nombre, args: args as Record<string, unknown> }] }),
          new AIMessage('listo'),
        ];
        let llamadas = 0;
        const llm = {
          invoke: vi.fn(async () => respuestas[Math.min(llamadas++, respuestas.length - 1)]),
          bindTools: function (this: unknown) { return this; },
        };
        llm.bindTools = llm.bindTools.bind(llm);

        const grafo = construirGrafo({
          prisma,
          calendarService,
          llm: llm as never,
          openRouter: { chat: vi.fn() } as unknown as OpenRouterClient,
          checkpointer: new MemorySaver(),
        });

        await expect(
          grafo.invoke(
            { messages: [new HumanMessage('fuzz')], ownerUserId: 'user-1', remoteJid: '54911@s.whatsapp.net', esPropietario },
            { configurable: { thread_id: `fuzz-${Math.random()}` }, recursionLimit: LIMITE_RECURSION },
          ),
        ).resolves.toBeDefined();

        const esAccionDelCatalogoHabilitada = (ACCIONES_IDS as string[]).includes(nombre) && AGENT.allowedActions.includes(nombre);
        if (!esAccionDelCatalogoHabilitada && nombre !== 'listar_eventos_calendario') {
          expect(calendarService.crearEvento).not.toHaveBeenCalled();
          expect(calendarService.cancelarEvento).not.toHaveBeenCalled();
          expect(calendarService.reprogramarEvento).not.toHaveBeenCalled();
        }
      }),
      SEMILLA,
    );
  });
});
