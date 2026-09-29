import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './token-crypto.js';

describe('token-crypto', () => {
  const clave = randomBytes(32).toString('hex');

  it('cifra y descifra el mismo valor', () => {
    const guardado = encryptToken('1//refresh-token-de-google', clave);

    expect(guardado).not.toContain('refresh-token-de-google');
    expect(guardado.split(':')).toHaveLength(3);
    expect(decryptToken(guardado, clave)).toBe('1//refresh-token-de-google');
  });

  it('usa un IV distinto en cada cifrado', () => {
    expect(encryptToken('mismo', clave)).not.toBe(encryptToken('mismo', clave));
  });

  it('falla si el texto cifrado fue alterado', () => {
    const [iv, tag, cifrado] = encryptToken('mismo', clave).split(':');
    // XOR y no un valor fijo: pisar el último byte con `ff` no cambia nada
    // cuando ya valía 0xff (1 de cada 256 corridas, el IV es aleatorio).
    const bytes = Buffer.from(cifrado, 'hex');
    bytes[bytes.length - 1] ^= 0x01;
    const alterado = `${iv}:${tag}:${bytes.toString('hex')}`;

    expect(alterado).not.toBe(`${iv}:${tag}:${cifrado}`);
    expect(() => decryptToken(alterado, clave)).toThrow();
  });

  it('falla con otra clave', () => {
    const guardado = encryptToken('mismo', clave);

    expect(() => decryptToken(guardado, randomBytes(32).toString('hex'))).toThrow();
  });
});
