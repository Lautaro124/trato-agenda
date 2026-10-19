import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { FRASES_DE_ROBOT, pistaDeEmoji, reglasDeNaturalidad } from './naturalidad.js';

describe('reglasDeNaturalidad', () => {
  const reglas = reglasDeNaturalidad('Estudio Mardel', 'que si prefiere, Estudio Mardel le contesta por este chat');

  it('habla como la persona que atiende el WhatsApp del negocio', () => {
    expect(reglas).toContain('la persona que atiende el WhatsApp de Estudio Mardel');
    expect(reglas).toContain('Acompañá el tono del cliente');
  });

  it('prohíbe las muletillas de bot, una por una', () => {
    for (const frase of FRASES_DE_ROBOT) expect(reglas).toContain(frase);
  });

  it('nunca niega ser automático si se lo preguntan en serio, y ofrece al dueño', () => {
    expect(reglas).toContain('nunca lo niegues ni digas que sos una persona');
    expect(reglas).toContain('sos un asistente automático');
    expect(reglas).toContain('Estudio Mardel le contesta por este chat');
  });

  it('explica que una línea en blanco parte la respuesta en mensajes, hasta tres', () => {
    expect(reglas).toContain('línea en blanco');
    expect(reglas).toContain('Como mucho tres partes');
  });
});

describe('pistaDeEmoji', () => {
  const cliente = new HumanMessage('hola');
  const conEmoji = new AIMessage('¡Buenísimo! 🙌');
  const sinEmoji = (texto = 'Dale, te lo anoto.') => new AIMessage(texto);
  const llamada = new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'buscar_productos', args: {} }] });

  it('en el primer mensaje no dice nada', () => {
    expect(pistaDeEmoji([cliente])).toBe('');
  });

  it('después de un mensaje con emoji, el siguiente va sin', () => {
    expect(pistaDeEmoji([cliente, conEmoji, cliente])).toContain('ninguno');
  });

  it('después de dos sin emoji, este lleva uno', () => {
    expect(pistaDeEmoji([cliente, sinEmoji(), cliente, llamada, sinEmoji('Sale $ 8.000.'), cliente])).toContain(
      'sumá uno solo',
    );
  });

  it('con una sola respuesta sin emoji queda a su criterio', () => {
    expect(pistaDeEmoji([cliente, conEmoji, cliente, sinEmoji(), cliente])).toBe('');
  });

  it('las llamadas a herramientas no cuentan como respuestas', () => {
    expect(pistaDeEmoji([cliente, conEmoji, cliente, llamada])).toContain('ninguno');
  });
});
