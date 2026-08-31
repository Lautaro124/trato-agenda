import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * El refresh token de Google es una credencial de larga vida sobre el
 * calendario del usuario, así que se guarda cifrado: `iv:authTag:ciphertext`.
 */
export function encryptToken(plano: string, claveHex: string): string {
  const clave = Buffer.from(claveHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITMO, clave, iv);
  const cifrado = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()]);

  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), cifrado.toString('hex')].join(
    ':',
  );
}

export function decryptToken(guardado: string, claveHex: string): string {
  const [ivHex, tagHex, cifradoHex] = guardado.split(':');
  if (!ivHex || !tagHex || !cifradoHex) {
    throw new Error('Token cifrado con formato inválido.');
  }

  const decipher = createDecipheriv(ALGORITMO, Buffer.from(claveHex, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  return Buffer.concat([
    decipher.update(Buffer.from(cifradoHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
