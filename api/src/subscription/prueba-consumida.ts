import { createHmac } from 'node:crypto';
import { claveDeTelefono } from '../auth/telefono.js';
import { esGoogleIdDev } from '../auth/usuario-dev.js';

/**
 * El mes de prueba cuenta desde el alta (`User.createdAt`). Al borrar la cuenta
 * esa fecha se pierde, así que se deja una lápida por identidad: un HMAC (nunca
 * el dato legible) y la fecha de alta. Si la misma identidad vuelve, la prueba
 * sigue contando desde la primera vez. Pura, sin I/O.
 */

export type IdentidadDeUsuario = {
  googleId: string | null;
  email: string | null;
  phoneNumber: string | null;
};

/** Subclave propia de la lápida, derivada de TOKEN_ENCRYPTION_KEY como `idDeFila`. */
function subclave(claveHex: string): Buffer {
  return createHmac('sha256', Buffer.from(claveHex, 'hex')).update('trato/prueba/v1').digest();
}

/**
 * Una huella por identidad presente. El teléfono pasa por `claveDeTelefono`
 * (9/15/0 son el mismo número) y el email va en minúsculas. Las cuentas de
 * desarrollo (`dev:`) no tienen lápida.
 */
export function huellasDeIdentidad(identidad: IdentidadDeUsuario, claveHex: string): string[] {
  const clave = subclave(claveHex);
  const valores: string[] = [];
  if (identidad.googleId && !esGoogleIdDev(identidad.googleId)) valores.push(`google\n${identidad.googleId}`);
  // El mail solo cuenta si la cuenta es de Google (mail verificado por Google): en una
  // cuenta de WhatsApp lo tipea la persona en el checkout, y alguien podría poner el de
  // un tercero y borrar su cuenta para quemarle la prueba.
  if (identidad.email && identidad.googleId && !esGoogleIdDev(identidad.googleId)) valores.push(`email\n${identidad.email.trim().toLowerCase()}`);
  if (identidad.phoneNumber) valores.push(`tel\n${claveDeTelefono(identidad.phoneNumber)}`);
  return valores.map((valor) => createHmac('sha256', clave).update(valor).digest('base64url'));
}

/** Inicio efectivo de la prueba: el más antiguo entre el alta actual y las lápidas. */
export function inicioDePrueba(creadoEl: Date, lapidas: Date[]): Date {
  return lapidas.reduce((masViejo, inicio) => (inicio < masViejo ? inicio : masViejo), creadoEl);
}
