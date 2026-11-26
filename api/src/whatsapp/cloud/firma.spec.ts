import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { challengeDeVerificacion, firmaDeMetaValida } from './firma.js';

const SECRETO = 'secreto-de-la-app';
const CUERPO = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

function firmar(cuerpo: Buffer, secreto = SECRETO): string {
  return `sha256=${createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
}

describe('firmaDeMetaValida', () => {
  it('acepta la firma del secreto sobre el cuerpo crudo', () => {
    expect(firmaDeMetaValida(CUERPO, firmar(CUERPO), SECRETO)).toBe(true);
  });

  it('rechaza un cuerpo cambiado, otro secreto, sin firma o sin secreto configurado', () => {
    expect(firmaDeMetaValida(Buffer.from(`${CUERPO.toString()} `), firmar(CUERPO), SECRETO)).toBe(false);
    expect(firmaDeMetaValida(CUERPO, firmar(CUERPO, 'otro'), SECRETO)).toBe(false);
    expect(firmaDeMetaValida(CUERPO, undefined, SECRETO)).toBe(false);
    expect(firmaDeMetaValida(CUERPO, firmar(CUERPO), '')).toBe(false);
  });

  it('rechaza formatos raros sin romper', () => {
    expect(firmaDeMetaValida(CUERPO, 'sha1=abc', SECRETO)).toBe(false);
    expect(firmaDeMetaValida(CUERPO, 'sha256=zz', SECRETO)).toBe(false);
    expect(firmaDeMetaValida(CUERPO, `sha256=${'a'.repeat(63)}`, SECRETO)).toBe(false);
  });
});

describe('challengeDeVerificacion', () => {
  const TOKEN = 'token-de-verificacion-largo';

  it('devuelve el challenge con el token correcto', () => {
    expect(
      challengeDeVerificacion({ 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '1158201444' }, TOKEN),
    ).toBe('1158201444');
  });

  it('no lo devuelve con otro token, otro modo o sin token configurado', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '123' };
    expect(challengeDeVerificacion({ ...query, 'hub.verify_token': 'otro' }, TOKEN)).toBeNull();
    expect(challengeDeVerificacion({ ...query, 'hub.mode': 'unsubscribe' }, TOKEN)).toBeNull();
    expect(challengeDeVerificacion(query, '')).toBeNull();
  });

  it('no refleja un challenge con caracteres que podrían ser HTML', () => {
    expect(
      challengeDeVerificacion({ 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '<script>' }, TOKEN),
    ).toBeNull();
  });
});
