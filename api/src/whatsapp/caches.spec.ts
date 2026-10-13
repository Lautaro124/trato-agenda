import { describe, expect, it } from 'vitest';
import { CacheConVencimiento, MensajesEnviados } from './caches.js';

describe('CacheConVencimiento', () => {
  it('devuelve lo guardado hasta que vence, y después nada', () => {
    let ahora = 1_000;
    const cache = new CacheConVencimiento(500, () => ahora);
    cache.set('a', 1);

    expect(cache.get('a')).toBe(1);
    ahora = 1_499;
    expect(cache.get('a')).toBe(1);
    ahora = 1_500;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.tamano).toBe(0);
  });

  it('del y flushAll borran', () => {
    const cache = new CacheConVencimiento(1_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.del('a');
    expect(cache.get('a')).toBeUndefined();
    cache.flushAll();
    expect(cache.get('b')).toBeUndefined();
  });

  it('no crece sin límite: pasado el máximo descarta los más viejos', () => {
    const cache = new CacheConVencimiento(60_000);
    for (let i = 0; i < 5_010; i++) cache.set(`m${i}`, i);
    expect(cache.tamano).toBeLessThanOrEqual(5_000);
    expect(cache.get('m0')).toBeUndefined();
    expect(cache.get('m5009')).toBe(5_009);
  });
});

describe('MensajesEnviados', () => {
  it('encuentra un mensaje enviado por su id, sólo en la cuenta que lo mandó', () => {
    const enviados = new MensajesEnviados();
    enviados.guardar('user-1', 'ABC', { conversation: 'hola' });

    expect(enviados.buscar('user-1', 'ABC')).toEqual({ conversation: 'hola' });
    expect(enviados.buscar('user-2', 'ABC')).toBeUndefined();
    expect(enviados.buscar('user-1', undefined)).toBeUndefined();
  });

  it('guarda los últimos N por cuenta y olvida los más viejos', () => {
    const enviados = new MensajesEnviados(2);
    enviados.guardar('user-1', 'a', { conversation: '1' });
    enviados.guardar('user-1', 'b', { conversation: '2' });
    enviados.guardar('user-1', 'c', { conversation: '3' });

    expect(enviados.buscar('user-1', 'a')).toBeUndefined();
    expect(enviados.buscar('user-1', 'c')).toEqual({ conversation: '3' });
  });

  it('ignora envíos sin id o sin contenido, y olvidar limpia la cuenta', () => {
    const enviados = new MensajesEnviados();
    enviados.guardar('user-1', undefined, { conversation: 'x' });
    enviados.guardar('user-1', 'a', undefined);
    enviados.guardar('user-1', 'b', { conversation: 'y' });
    enviados.olvidar('user-1');

    expect(enviados.buscar('user-1', 'a')).toBeUndefined();
    expect(enviados.buscar('user-1', 'b')).toBeUndefined();
  });
});
