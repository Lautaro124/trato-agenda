import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearNodoConversacion } from '../graph/nodes/conversacion.node.js';
import type { EstadoConversacionUpdate, EstadoConversacionValue } from '../graph/state.js';
import { MENSAJE_DISCULPA_GENERICO } from '../mensajes.js';

function mensajesDe(actualizacion: EstadoConversacionUpdate): AIMessage[] {
  return actualizacion.messages as unknown as AIMessage[];
}

/**
 * `conversacion.node.ts` no implementa el timeout en sí (eso lo hace
 * `ChatOpenAI` con `timeout: 40_000` en `llm.provider.ts`, una integración de
 * LangChain que no se reimplementa acá): lo que este archivo verifica es el
 * límite de responsabilidad propio — que el catch del nodo trata cualquier
 * rechazo del modelo (llegue como AbortError justo en el límite, un poco
 * después, o lo que sea) de la misma forma segura, sin importar CUÁNDO
 * ocurrió. No se usa como criterio universal que "más de 40s = falla": eso lo
 * decide LangChain, acá sólo se ve la reacción del código propio.
 */
function estadoBase(): EstadoConversacionValue {
  return {
    messages: [new HumanMessage('hola')],
    ownerUserId: 'user-1',
    remoteJid: '54911@s.whatsapp.net',
    esPropietario: false,
    contexto: {
      agent: { allowedActions: [] } as never,
      conversation: { id: 'conv-1' } as never,
      turnoActivo: null,
      bloqueSistema: 'Sos Tati.',
    },
    agenda: { desde: new Date(), hasta: new Date(), ocupados: [], falla: false },
    pendientes: [],
    indiceDesde: 0,
  } as unknown as EstadoConversacionValue;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('timeouts con reloj falso (dimensión RL4: recursos limitados)', () => {
  it('RL4-001: una demora de 39.9s simuladas que sí resuelve no dispara la disculpa genérica', async () => {
    const llm = {
      invoke: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(new AIMessage('Tarde pero llegué.')), 39_900))),
      bindTools: undefined,
    };
    const nodo = crearNodoConversacion({ llm: llm as never });

    const promesa = nodo(estadoBase());
    await vi.advanceTimersByTimeAsync(39_900);
    const actualizacion = await promesa;

    expect(mensajesDe(actualizacion)[0]?.content).toBe('Tarde pero llegué.');
  });

  it('RL4-002: un rechazo tipo AbortError (timeout) dispara la disculpa genérica sin tool_calls', async () => {
    const llm = {
      invoke: vi.fn(() => new Promise((_resolve, reject) => setTimeout(() => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), 40_000))),
      bindTools: undefined,
    };
    const nodo = crearNodoConversacion({ llm: llm as never });

    const promesa = nodo(estadoBase());
    await vi.advanceTimersByTimeAsync(40_000);
    const actualizacion = await promesa;

    const respuesta = mensajesDe(actualizacion)[0];
    expect(respuesta.content).toBe(MENSAJE_DISCULPA_GENERICO);
    expect(respuesta.tool_calls ?? []).toHaveLength(0);
  });

  it('RL4-003: un rechazo justo después del timeout (40.1s) se comporta igual que en el límite', async () => {
    const llm = {
      invoke: vi.fn(() => new Promise((_resolve, reject) => setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 40_100))),
      bindTools: undefined,
    };
    const nodo = crearNodoConversacion({ llm: llm as never });

    const promesa = nodo(estadoBase());
    await vi.advanceTimersByTimeAsync(40_100);
    const actualizacion = await promesa;

    expect(mensajesDe(actualizacion)[0].content).toBe(MENSAJE_DISCULPA_GENERICO);
  });
});
