import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Contraseñas de las cuentas que entran con número de WhatsApp. Funciones
 * puras sobre `node:crypto` (scrypt), sin dependencias: el formato guarda los
 * parámetros junto al hash (`scrypt$N$r$p$sal$hash`, en base64), así subir el
 * costo más adelante no rompe los hashes que ya existen.
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const N = 16384;
const R = 8;
const P = 1;
const LARGO_CLAVE = 32;
const LARGO_SAL = 16;

function scrypt(plano: string, sal: Buffer, largo: number, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(plano, sal, largo, opciones, (error, clave) => (error ? reject(error) : resolve(clave)));
  });
}

export async function hashearPassword(plano: string): Promise<string> {
  const sal = randomBytes(LARGO_SAL);
  const clave = await scrypt(plano, sal, LARGO_CLAVE, { N, r: R, p: P });
  return ['scrypt', N, R, P, sal.toString('base64'), clave.toString('base64')].join('$');
}

/** Un hash con formato inválido cuenta como contraseña incorrecta, nunca como error. */
export async function passwordCorrecta(plano: string, hash: string): Promise<boolean> {
  const [algoritmo, n, r, p, sal, clave] = hash.split('$');
  if (algoritmo !== 'scrypt' || !sal || !clave) return false;
  const esperada = Buffer.from(clave, 'base64');
  try {
    const recibida = await scrypt(plano, Buffer.from(sal, 'base64'), esperada.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
  } catch {
    return false;
  }
}

/**
 * Hash de una contraseña que nadie tiene. Se verifica contra él cuando el
 * número no existe o la cuenta no tiene contraseña, para que el tiempo de
 * respuesta sea el mismo y no delate qué números tienen cuenta.
 */
export const HASH_FALSO = `scrypt$${N}$${R}$${P}$${Buffer.alloc(LARGO_SAL).toString('base64')}$${Buffer.alloc(LARGO_CLAVE).toString('base64')}`;
