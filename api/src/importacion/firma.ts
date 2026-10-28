/**
 * La vista previa vuelve firmada: la confirmación sólo acepta el origen y las
 * fotos que salieron de una extracción de esta misma cuenta, hace menos de
 * VIGENCIA_FIRMA_MS. Sin esto, `POST /importacion/confirmar` serviría para
 * mandarle a la API a bajar cualquier URL como foto, o para marcar un
 * producto con el origen de otro. HMAC con una subclave de
 * TOKEN_ENCRYPTION_KEY, igual que prueba-consumida.ts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const VIGENCIA_FIRMA_MS = 60 * 60 * 1000;

export type DatosFirmados = { userId: string; claveOrigen: string; origenUrl: string; imagenes: string[]; emitidaAt: string };

function subclave(claveHex: string): Buffer {
  return createHmac('sha256', Buffer.from(claveHex, 'hex')).update('trato/importacion/v1').digest();
}

export function firmarBorrador(datos: DatosFirmados, claveHex: string): string {
  const contenido = JSON.stringify([datos.userId, datos.claveOrigen, datos.origenUrl, datos.imagenes, datos.emitidaAt]);
  return createHmac('sha256', subclave(claveHex)).update(contenido).digest('base64url');
}

/** Si la firma es de estos datos y todavía vale. */
export function firmaValida(datos: DatosFirmados, firma: string, claveHex: string, ahora: number = Date.now()): boolean {
  const emitida = Date.parse(datos.emitidaAt);
  if (!Number.isFinite(emitida) || emitida > ahora + 60_000 || ahora - emitida > VIGENCIA_FIRMA_MS) return false;
  const esperada = Buffer.from(firmarBorrador(datos, claveHex));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}
