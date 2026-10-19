import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { estadoDeLaCharla, etapaDesdeOrden, MENSAJES_PARA_ETAPA, pedidoDeEtapa } from './etapa-de-compra.js';

describe('estadoDeLaCharla', () => {
  it('junta los dos lados, sin llamadas a herramientas ni sus resultados', () => {
    const estado = estadoDeLaCharla([
      new HumanMessage('Hola, quiero una mesa de 1,80'),
      new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'buscar_productos', args: {} }] }),
      new ToolMessage({ content: 'Resultados de "mesa"…', tool_call_id: 't1' }),
      new AIMessage('La Mesa Roble sale $ 300.000.\n\n¿Querés algo más?'),
      new HumanMessage('no, eso'),
    ]);
    expect(estado).toBe('Customer: Hola, quiero una mesa de 1,80\nShop: La Mesa Roble sale $ 300.000. ¿Querés algo más?\nCustomer: no, eso');
  });

  it('tapa el nombre del cliente que ya sabemos, también en lo que contestó el asistente', () => {
    const estado = estadoDeLaCharla(
      [new HumanMessage('soy Juan Pérez'), new AIMessage('¡Genial, juan! ¿Algo más, Juanito?')],
      'Juan Pérez',
    );
    expect(estado).toBe('Customer: soy [name] [name]\nShop: ¡Genial, [name]! ¿Algo más, Juanito?');
  });

  it('tapa emails y números largos (DNI, teléfono, código postal), no precios cortos ni cantidades', () => {
    const estado = estadoDeLaCharla([
      new HumanMessage('mi mail es juan@mail.com, DNI 30.111.222, tel +54 9 11 5555-1234, CP 1414; quiero 2'),
      new AIMessage('Dale, la mesa de 180 cm a $ 300.000'),
    ]);
    expect(estado).toBe(
      'Customer: mi mail es [email] DNI [number], tel [number], CP [number]; quiero 2\nShop: Dale, la mesa de 180 cm a $ 300.000',
    );
  });

  it('sin respuestas del negocio todavía no hay nada que decidir', () => {
    expect(estadoDeLaCharla([new HumanMessage('hola')])).toBe('');
  });

  it('se queda con los últimos mensajes', () => {
    const mensajes = Array.from({ length: 20 }, (_, indice) =>
      indice % 2 === 0 ? new HumanMessage(`cliente ${indice}`) : new AIMessage(`negocio ${indice}`),
    );
    const lineas = estadoDeLaCharla(mensajes).split('\n');
    expect(lineas).toHaveLength(MENSAJES_PARA_ETAPA);
    expect(lineas.at(-1)).toBe('Shop: negocio 19');
  });
});

describe('pedidoDeEtapa', () => {
  it('ante la duda, "defining" va primero', () => {
    expect(Object.keys(pedidoDeEtapa('Customer: hola').opciones)).toEqual(['defining', 'ready']);
  });
});

describe('etapaDesdeOrden', () => {
  it('traduce la elegida', () => {
    expect(etapaDesdeOrden(['ready', 'defining'])).toBe('lista');
    expect(etapaDesdeOrden(['defining', 'ready'])).toBe('eligiendo');
    expect(etapaDesdeOrden([])).toBeNull();
  });
});
