import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import {
  conMarcaDeLlegada,
  inicioVisible,
  mensajesVisibles,
  prepararHistorial,
  recibidoEn,
  sinParesCortados,
} from './ventana-historial.js';

const AHORA = new Date('2026-10-06T12:00:00Z');
const HORA = 60 * 60_000;
const DIA = 24 * HORA;

function humano(texto: string, haceMs: number | null): HumanMessage {
  const mensaje = new HumanMessage({ content: texto, id: `h-${texto}` });
  return haceMs === null ? mensaje : conMarcaDeLlegada(mensaje, new Date(AHORA.getTime() - haceMs));
}

function tipos(mensajes: BaseMessage[]): string[] {
  return mensajes.map((mensaje) => `${mensaje.getType()}:${String(mensaje.content)}`);
}

describe('marca de llegada', () => {
  it('conserva el id y el contenido, y no la pisa si ya la tenía', () => {
    const marcado = humano('hola', 0);

    expect(marcado.id).toBe('h-hola');
    expect(marcado.content).toBe('hola');
    expect(recibidoEn(marcado)).toEqual(AHORA);
    expect(recibidoEn(new HumanMessage('sin marca'))).toBeNull();
  });
});

describe('inicioVisible', () => {
  it('deja afuera lo que llegó antes de la ventana, cortando en un mensaje del cliente', () => {
    const mensajes = [
      humano('viejo', 20 * DIA),
      new AIMessage('respuesta vieja'),
      humano('reciente', 2 * DIA),
      new AIMessage('respuesta reciente'),
      humano('ahora', 0),
    ];

    expect(inicioVisible(mensajes, AHORA, 14 * DIA)).toBe(2);
    // Con una ventana de 2 horas sólo queda el mensaje que acaba de llegar.
    expect(inicioVisible(mensajes, AHORA, 2 * HORA)).toBe(4);
  });

  it('los mensajes sin marca (de antes de que existiera) cuentan como viejos', () => {
    const mensajes = [humano('de antes', null), new AIMessage('respuesta'), humano('ahora', 0)];

    expect(inicioVisible(mensajes, AHORA, 14 * DIA)).toBe(2);
  });

  it('el último mensaje queda siempre adentro, aunque no tenga marca', () => {
    const mensajes = [new AIMessage('algo'), humano('sin marca', null)];

    expect(inicioVisible(mensajes, AHORA, 14 * DIA)).toBe(1);
    expect(inicioVisible([], AHORA, 14 * DIA)).toBe(0);
  });
});

describe('sinParesCortados', () => {
  it('saca el par tool call/resultado que quedó cortado a mitad de una vuelta (hilo roto)', () => {
    const mensajes = [
      humano('busco algo', HORA),
      new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'buscar_productos', args: { consulta: 'x' } }] }),
      // La vuelta se cortó acá (por ejemplo, sin vueltas): nunca llegó el ToolMessage.
      humano('¿hola?', 0),
    ];

    expect(tipos(sinParesCortados(mensajes))).toEqual(['human:busco algo', 'human:¿hola?']);
  });

  it('deja los pares completos y descarta resultados huérfanos', () => {
    const mensajes = [
      new ToolMessage({ content: 'huérfano', tool_call_id: 'viejo' }),
      new AIMessage({ content: '', tool_calls: [{ id: 'call-2', name: 'consultar_turno', args: {} }] }),
      new ToolMessage({ content: 'No hay turnos.', tool_call_id: 'call-2' }),
      new AIMessage('No tenés turnos.'),
    ];

    expect(tipos(sinParesCortados(mensajes))).toEqual(['ai:', 'tool:No hay turnos.', 'ai:No tenés turnos.']);
  });
});

describe('prepararHistorial', () => {
  it('marca el mensaje que acaba de llegar y calcula lo que ve el modelo', () => {
    const mensajes = [humano('viejo', 30 * DIA), new AIMessage('respuesta vieja'), new HumanMessage({ content: 'nuevo', id: 'n' })];

    const historial = prepararHistorial(mensajes, AHORA, 14 * DIA);

    expect(historial.marcado?.id).toBe('n');
    expect(recibidoEn(historial.marcado as HumanMessage)).toEqual(AHORA);
    expect(historial.inicio).toBe(2);
    expect(tipos(historial.visibles)).toEqual(['human:nuevo']);
    expect(historial.hayHistorialOculto).toBe(true);
  });

  it('con toda la charla dentro de la ventana no oculta nada', () => {
    const mensajes = [humano('hola', HORA), new AIMessage('¡Hola!'), humano('quiero un turno', 0)];

    const historial = prepararHistorial(mensajes, AHORA, 14 * DIA);

    expect(historial.marcado).toBeNull();
    expect(historial.inicio).toBe(0);
    expect(historial.hayHistorialOculto).toBe(false);
    expect(mensajesVisibles(mensajes, historial.inicio)).toHaveLength(3);
  });
});
