import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { contarToolCallsNuevas } from './medicion.js';

function llamada(id: string, name: string) {
  return new AIMessage({ content: '', tool_calls: [{ id, name, args: {} }] });
}

describe('contarToolCallsNuevas', () => {
  it('cuenta una sola tool call por mensaje, no por cada invoke del thread', () => {
    // Regresión: el bug original usaba `estado.messages.slice(-12)` sobre un
    // thread persistente entre invokes. Con pocos mensajes por caso, la
    // ventana fija seguía incluyendo el AIMessage del primer mensaje al contar
    // el segundo, así que la misma tool call se sumaba dos veces.
    const cursor0 = 0;
    const vistos = new Set<string>();

    // Vuelta 1: humano + AIMessage con una tool call.
    const mensajes1 = [new HumanMessage('quiero un turno'), llamada('call-1', 'crear_turno')];
    const conteo1 = contarToolCallsNuevas(mensajes1, cursor0, vistos);
    expect(conteo1.herramientas).toEqual(['crear_turno']);

    // Vuelta 2 (mismo thread, checkpointer acumula): el mensaje anterior sigue
    // en el array, más uno nuevo sin tool calls.
    const mensajes2 = [...mensajes1, new HumanMessage('confirmo'), new AIMessage('Listo.')];
    const conteo2 = contarToolCallsNuevas(mensajes2, conteo1.cursor, vistos);

    expect(conteo2.herramientas).toEqual([]);
    expect([...conteo1.herramientas, ...conteo2.herramientas]).toEqual(['crear_turno']);
  });

  it('no recuenta aunque dos AIMessage compartan el mismo tool_call_id', () => {
    const vistos = new Set<string>();
    const mensajes = [llamada('call-1', 'crear_turno')];
    const conteo1 = contarToolCallsNuevas(mensajes, 0, vistos);
    // Reentrada explícita del mismo id (ej. un reintento que reenvía el mismo AIMessage).
    const conteo2 = contarToolCallsNuevas(mensajes, 0, vistos);

    expect(conteo1.herramientas).toEqual(['crear_turno']);
    expect(conteo2.herramientas).toEqual([]);
  });

  it('cuenta varias tool calls de un mismo AIMessage', () => {
    const dos = new AIMessage({
      content: '',
      tool_calls: [
        { id: 'call-1', name: 'crear_turno', args: {} },
        { id: 'call-2', name: 'crear_turno', args: {} },
      ],
    });
    const conteo = contarToolCallsNuevas([dos], 0, new Set());
    expect(conteo.herramientas).toEqual(['crear_turno', 'crear_turno']);
  });
});
