import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MARCA_RECORTE,
  MAX_TOKENS_ENTRADA,
  ajustarAlPresupuesto,
  conMarcaDeLlegada,
  estimarTokens,
  textoDeHerramientas,
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

describe('ajustarAlPresupuesto', () => {
  /** Un texto que pesa ~`tokens` tokens estimados. */
  const deTokens = (tokens: number, letra = 'a') => letra.repeat(Math.round(tokens * 3.5));

  it('si entra, manda todo igual', () => {
    const mensajes = [new HumanMessage('hola'), new AIMessage('¡Hola!'), new HumanMessage('quiero un turno')];

    const entrada = ajustarAlPresupuesto('sistema', mensajes);

    expect(entrada.mensajes).toEqual(mensajes);
    expect(entrada).toMatchObject({ descartados: 0, acortado: false, excedido: false });
  });

  it('saca vueltas viejas enteras, sin separar una tool call de su resultado', () => {
    const llamada = new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'consultar', args: {} }] });
    const mensajes = [
      new HumanMessage(deTokens(30, 'v')),
      llamada,
      new ToolMessage({ content: deTokens(30, 'r'), tool_call_id: 't1' }),
      new AIMessage('listo'),
      new HumanMessage('y el jueves?'),
      new AIMessage('dejame ver'),
      new HumanMessage('dale'),
    ];

    const entrada = ajustarAlPresupuesto('', mensajes, 40);

    expect(tipos(entrada.mensajes)).toEqual(['human:y el jueves?', 'ai:dejame ver', 'human:dale']);
    expect(entrada.descartados).toBe(4);
    expect(entrada.excedido).toBe(false);
    expect(entrada.tokens).toBeLessThanOrEqual(40);
  });

  it('la vuelta en curso queda siempre, con sus tool calls', () => {
    const llamada = new AIMessage({ content: '', tool_calls: [{ id: 't1', name: 'consultar', args: {} }] });
    const mensajes = [
      new HumanMessage('viejo'),
      new HumanMessage('quiero un turno'),
      llamada,
      new ToolMessage({ content: 'libre', tool_call_id: 't1' }),
    ];

    const entrada = ajustarAlPresupuesto(deTokens(100), mensajes, 50);

    expect(entrada.mensajes.slice(-2)).toEqual([llamada, mensajes[3]]);
    expect(entrada.descartados).toBe(1);
  });

  it('si la vuelta en curso sola no entra, acorta el mensaje del cliente más largo (un audio) y no muta el estado', () => {
    const audio = new HumanMessage({ content: deTokens(50_000), id: 'audio' });
    const mensajes = [new HumanMessage('hola'), new AIMessage('¡Hola!'), audio];

    const entrada = ajustarAlPresupuesto(deTokens(5_000), mensajes);

    expect(entrada.descartados).toBe(2);
    expect(entrada.acortado).toBe(true);
    expect(entrada.excedido).toBe(false);
    expect(entrada.tokens).toBeLessThanOrEqual(MAX_TOKENS_ENTRADA);
    const acortado = entrada.mensajes[0]!;
    expect(acortado.id).toBe('audio');
    expect(String(acortado.content).endsWith(MARCA_RECORTE)).toBe(true);
    expect(audio.content).toHaveLength(deTokens(50_000).length);
  });

  it('avisa si el system prompt solo ya pasa el tope', () => {
    const entrada = ajustarAlPresupuesto(deTokens(200), [new HumanMessage('hola')], 100);

    expect(entrada.excedido).toBe(true);
  });

  it('cuenta las herramientas con su schema', () => {
    const texto = textoDeHerramientas([
      { name: 'crear_turno', description: 'Reserva un turno', schema: z.object({ inicio: z.string().describe('ISO 8601') }) },
    ]);

    expect(texto).toContain('crear_turno');
    expect(texto).toContain('ISO 8601');
    expect(estimarTokens(texto)).toBeGreaterThan(estimarTokens('crear_turnoReserva un turno'));
  });
});
