import { describe, expect, it } from 'vitest';
import { HASH_FALSO, hashearPassword, passwordCorrecta } from './password.js';

describe('password', () => {
  it('verifica la contraseña correcta y rechaza otra', async () => {
    const hash = await hashearPassword('una-clave-larga');

    expect(await passwordCorrecta('una-clave-larga', hash)).toBe(true);
    expect(await passwordCorrecta('otra-clave-larga', hash)).toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos (sal aleatoria) y no la contienen', async () => {
    const a = await hashearPassword('una-clave-larga');
    const b = await hashearPassword('una-clave-larga');

    expect(a).not.toBe(b);
    expect(a).not.toContain('una-clave-larga');
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('un hash con formato roto cuenta como incorrecta, sin tirar', async () => {
    expect(await passwordCorrecta('x', 'no-es-un-hash')).toBe(false);
    expect(await passwordCorrecta('x', 'scrypt$0$0$0$AAAA$AAAA')).toBe(false);
  });

  it('nada coincide con HASH_FALSO', async () => {
    expect(await passwordCorrecta('', HASH_FALSO)).toBe(false);
    expect(await passwordCorrecta('una-clave-larga', HASH_FALSO)).toBe(false);
  });
});
