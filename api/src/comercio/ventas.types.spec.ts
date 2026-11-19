import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { aMensajesPublicos } from './ventas.types.js';

const createdAt = new Date('2026-11-19T12:00:00Z');

describe('aMensajesPublicos', () => {
  it('devuelve las fotos que mandó el asistente, aunque el mensaje no tenga texto', () => {
    const mensajes = aMensajesPublicos([
      {
        role: 'assistant',
        createdAt,
        content: {
          content: '',
          imagenes: [
            { productoId: 'p-1', leyenda: 'Mate\n$ 8.000' },
            { productoId: 'p-2', imagenId: 'img-2', leyenda: 'Termo' },
            { imagenPreguntaId: 'pre-1', leyenda: 'Lino' },
          ],
        },
      },
    ]);
    expect(mensajes).toEqual([
      {
        de: 'asistente',
        texto: '',
        createdAt,
        imagenes: [
          { productoId: 'p-1', leyenda: 'Mate\n$ 8.000' },
          { productoId: 'p-2', imagenId: 'img-2', leyenda: 'Termo' },
          { imagenPreguntaId: 'pre-1', leyenda: 'Lino' },
        ],
      },
    ]);
  });

  it('descarta fotos con ids que no son ids y no muestra herramientas', () => {
    const mensajes = aMensajesPublicos([
      { role: 'assistant', createdAt, content: { content: 'Hola', imagenes: [{ productoId: '../x', leyenda: 'Mal' }, 'cualquier cosa'] } },
      { role: 'tool', createdAt, content: { content: 'Resultados de "mate"…' } },
      { role: 'user', createdAt, content: { content: 'Hola', imagenes: [{ productoId: 'p-1', leyenda: 'X' }] } },
    ]);
    expect(mensajes).toEqual([
      { de: 'asistente', texto: 'Hola', createdAt },
      { de: 'cliente', texto: 'Hola', createdAt },
    ]);
  });
});
