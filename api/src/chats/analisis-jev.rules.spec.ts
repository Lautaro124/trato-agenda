import { describe, expect, it } from 'vitest';
import { MAX_PREGUNTAS_DECISION } from '../comercio/decisiones.client.js';
import {
  estadoParaAnalisis,
  LARGO_MAX_ESTADO_ANALISIS,
  leerAnalisisJev,
  preguntasDeAnalisis,
  SENALES_A_FAVOR,
  SENALES_EN_CONTRA,
} from './analisis-jev.rules.js';

describe('estadoParaAnalisis', () => {
  it('arma la charla como Customer/Shop, con el nombre, los emails y los números largos tapados', () => {
    const estado = estadoParaAnalisis(
      [
        { de: 'cliente', texto: 'Hola, soy Martina Pérez, mi mail es martu@ejemplo.com' },
        { de: 'asistente', texto: 'Hola Martina, ¿qué buscás?' },
        { de: 'cliente', texto: 'Un esquinero, mi tel 11 4455 6677' },
      ],
      'Martina Pérez',
    );
    expect(estado).toBe(
      'Customer: Hola, soy [name] [name], mi mail es [email]\nShop: Hola [name], ¿qué buscás?\nCustomer: Un esquinero, mi tel [number]',
    );
  });

  it('sin mensajes del cliente no hay nada que decidir', () => {
    expect(estadoParaAnalisis([{ de: 'asistente', texto: 'Hola' }], null)).toBe('');
  });

  it('se queda con lo último si la charla es larga', () => {
    const mensajes = Array.from({ length: 16 }, () => ({ de: 'cliente' as const, texto: 'a'.repeat(400) }));
    const estado = estadoParaAnalisis(mensajes, null);
    expect(estado).toHaveLength(LARGO_MAX_ESTADO_ANALISIS);
    expect(estado.endsWith('a')).toBe(true);
  });
});

describe('preguntasDeAnalisis', () => {
  it('entra en un solo pedido y ninguna opción se llama "none"', () => {
    const preguntas = preguntasDeAnalisis();
    expect(Object.keys(preguntas).length).toBeLessThanOrEqual(MAX_PREGUNTAS_DECISION);
    expect(preguntas.compra?.tipo).toBe('noul');
    for (const pregunta of Object.values(preguntas)) {
      if (pregunta.tipo === 'choice') expect(Object.keys(pregunta.opciones)).not.toContain('none');
    }
  });
});

describe('leerAnalisisJev', () => {
  it('pasa las probabilidades de Jev al análisis, con las señales del catálogo', () => {
    const analisis = leerAnalisisJev({
      compra: 0.784,
      sentimiento: { neutro: 0.2, positivo: 0.7, negativo: 0.1, none: 0 },
      tendencia: { estable: 0.3, mejora: 0.6, empeora: 0.1 },
      tema: { precio: 0.1, envio: 0.8, none: 0.1 },
      senal_pago: 0.9,
      senal_entrega: 0.7,
      senal_eligio: 0.65,
      senal_urgencia: 0.95,
      senal_caro: 0.61,
      senal_compara: 0.2,
    });
    expect(analisis).toEqual({
      probabilidad: 78,
      sentimiento: 'positivo',
      tendencia: 'mejora',
      tema: 'envio',
      // De mayor a menor y hasta tres.
      aFavor: [SENALES_A_FAVOR.urgencia.label, SENALES_A_FAVOR.pago.label, SENALES_A_FAVOR.entrega.label],
      enContra: [SENALES_EN_CONTRA.caro.label],
    });
  });

  it('si gana "none" o falta una respuesta, queda el valor neutro', () => {
    const analisis = leerAnalisisJev({ compra: 0.3, tema: { precio: 0.2, none: 0.7 } });
    expect(analisis).toMatchObject({ probabilidad: 30, sentimiento: 'neutro', tendencia: 'estable', tema: 'otro', aFavor: [], enContra: [] });
  });

  it('sin la probabilidad de compra no hay análisis', () => {
    expect(leerAnalisisJev({ sentimiento: { positivo: 1 } })).toBeNull();
  });
});
