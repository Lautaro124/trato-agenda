import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { memoriaDelCliente, yaSePresento } from './saludo.js';

describe('yaSePresento', () => {
  it('es falso con sólo el mensaje que acaba de llegar', () => {
    expect(yaSePresento([new HumanMessage('Hola, cómo estás?')])).toBe(false);
  });

  it('es verdadero si el asistente ya contestó antes en el hilo', () => {
    const mensajes = [
      new HumanMessage('Hola, cómo estás?'),
      new AIMessage('¡Hola! Soy Beto, ¿en qué te ayudo?'),
      new HumanMessage('Quiero comprar algo'),
    ];
    expect(yaSePresento(mensajes)).toBe(true);
  });

  it('sin un mensaje del asistente antes, no cuenta como presentado', () => {
    expect(yaSePresento([new ToolMessage({ content: 'x', tool_call_id: '1' }), new HumanMessage('hola')])).toBe(false);
  });
});

describe('memoriaDelCliente', () => {
  it('sin resumen ni charla previa es el primer contacto', () => {
    expect(memoriaDelCliente(null, false)).toBe('Primera vez que te escribe este número.');
  });

  it('sin resumen pero con la charla en curso no dice que es la primera vez', () => {
    expect(memoriaDelCliente(null, true)).not.toContain('Primera vez');
  });

  it('con resumen lo incluye', () => {
    expect(memoriaDelCliente('Busca mates.', true)).toContain('Busca mates.');
  });
});
