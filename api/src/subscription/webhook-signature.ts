import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificación de la firma de los webhooks de Mercado Pago.
 *
 * El manifiesto se arma con el header `x-signature` (que trae `ts` y `v1`), el
 * header `x-request-id` y el `data.id` del query string — no con el cuerpo
 * crudo del request, así que no hace falta habilitar rawBody en main.ts.
 */
export function firmaDeWebhookValida(entrada: {
  secret: string;
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  if (!entrada.secret || !entrada.xSignature || !entrada.dataId) return false;

  const partes = new Map(
    entrada.xSignature.split(',').map((parte) => {
      const [clave, ...resto] = parte.split('=');
      return [clave.trim(), resto.join('=').trim()];
    }),
  );
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1) return false;

  // Mercado Pago compara el id en minúsculas.
  const manifiesto = `id:${entrada.dataId.toLowerCase()};request-id:${entrada.xRequestId ?? ''};ts:${ts};`;
  const esperado = createHmac('sha256', entrada.secret).update(manifiesto).digest('hex');

  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
