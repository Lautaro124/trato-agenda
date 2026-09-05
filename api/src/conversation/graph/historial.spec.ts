import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { mensajesDesdeFilas } from './historial.js';

describe('mensajesDesdeFilas', () => {
  it('convierte los tres roles guardados', () => {
    const mensajes = mensajesDesdeFilas([
      { role: 'user', content: { content: 'hola' } },
      {
        role: 'assistant',
        content: {
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'consultar_turno', arguments: '{}' } },
          ],
        },
      },
      { role: 'tool', content: { content: 'No hay turnos.', tool_call_id: 'call-1' } },
      { role: 'assistant', content: { content: 'No tenés turnos.' } },
    ] as never);

    expect(mensajes.map((mensaje) => mensaje.getType())).toEqual(['human', 'ai', 'tool', 'ai']);
    expect((mensajes[1] as AIMessage).tool_calls?.[0]?.name).toBe('consultar_turno');
    expect((mensajes[2] as ToolMessage).tool_call_id).toBe('call-1');
  });

  it('descarta tool calls sin su resultado y resultados sin su tool call', () => {
    const mensajes = mensajesDesdeFilas([
      { role: 'tool', content: { content: 'huérfano', tool_call_id: 'viejo' } },
      {
        role: 'assistant',
        content: {
          content: '',
          tool_calls: [{ id: 'call-9', type: 'function', function: { name: 'crear_turno', arguments: '{}' } }],
        },
      },
    ] as never);

    expect(mensajes).toEqual([]);
  });
});
