import { describe, expect, it } from 'vitest';
import { FRASES_DE_ROBOT, reglasDeNaturalidad } from './naturalidad.js';

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
