import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearNodoCargarContexto } from '../nodes/cargar-contexto.node.js';
import type { EstadoConversacionValue } from '../state.js';
import { AGENT, crearCalendar, crearPrisma, hora } from './helpers.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(hora('08:00')));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * `cargar_contexto` no trunca `state.messages` — el límite de contexto real lo
 * define el proveedor de OpenRouter, no el código local (ver sección 4 de la
 * spec de evaluación: "limitar CPU/RAM local no limita su hardware de
 * inferencia"). Lo que este test verifica es la propiedad que sí depende de
 * código propio: `contexto.turnoActivo`, `agent` y el bloque de reglas salen
 * de Prisma, no de `state.messages`, así que un historial largo (25/75/95% y
 * más de un límite simulado) no debería poder degradarlos.
 */
const LIMITE_SIMULADO = 100;

function historialDe(cantidadDeMensajes: number): BaseMessage[] {
  const mensajes: BaseMessage[] = [];
  for (let i = 0; i < cantidadDeMensajes; i += 1) {
    mensajes.push(i % 2 === 0 ? new HumanMessage(`mensaje de cliente ${i}`) : new AIMessage(`respuesta ${i}`));
  }
  return mensajes;
}

describe('contexto simulado (dimensión RL1: recursos limitados)', () => {
  const turnoActivo = {
    id: 'turno-1',
    googleEventId: 'evento-abc',
    nombreCliente: 'Juan',
    inicio: new Date(hora('10:00')),
    fin: new Date(hora('10:30')),
    estado: 'confirmado',
    createdAt: new Date(),
  };

  for (const porcentaje of [0.25, 0.75, 0.95, 1, 1.2]) {
    const cantidad = Math.round(LIMITE_SIMULADO * porcentaje);

    it(`RL1-001: con ${Math.round(porcentaje * 100)}% del límite simulado (${cantidad} mensajes) no se pierde turnoActivo ni la identidad del agente`, async () => {
      const prisma = crearPrisma({ turnoActivo: turnoActivo as never });
      const calendarService = crearCalendar();
      const nodo = crearNodoCargarContexto({ prisma, calendarService });

      const estado = {
        messages: historialDe(cantidad),
        ownerUserId: 'user-1',
        remoteJid: '54911@s.whatsapp.net',
        esPropietario: false,
      } as unknown as EstadoConversacionValue;

      const actualizacion = await nodo(estado);

      expect(actualizacion.contexto?.turnoActivo?.id).toBe('turno-1');
      expect(actualizacion.contexto?.agent.nombreTitular).toBe(AGENT.nombreTitular);
      expect(actualizacion.contexto?.bloqueSistema).toContain('Reglas de la agenda de Tienda Centro');
      // indiceDesde siempre apunta al último mensaje entrante, sin importar el
      // largo total del historial acumulado en el thread.
      expect(actualizacion.indiceDesde).toBe(Math.max(cantidad - 1, 0));
    });
  }
});
