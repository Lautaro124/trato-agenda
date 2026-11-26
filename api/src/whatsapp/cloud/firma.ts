import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Clave al azar por proceso: sólo sirve para comparar sin filtrar tiempo, no protege nada. */
const CLAVE_DE_COMPARACION = randomBytes(32);

/**
 * El webhook de la Cloud API firma el cuerpo crudo con el secreto de la app:
 * `X-Hub-Signature-256: sha256=<hex>`. Sin esa firma (o con otra) no se mira
 * nada del cuerpo: la ruta no tiene sesión y cualquiera puede pegarle.
 */
export function firmaDeMetaValida(cuerpo: Buffer, cabecera: string | undefined, secreto: string): boolean {
  if (!secreto || typeof cabecera !== 'string' || !cabecera.startsWith('sha256=')) return false;
  const recibida = cabecera.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(recibida)) return false;
  const esperada = createHmac('sha256', secreto).update(cuerpo).digest();
  return timingSafeEqual(esperada, Buffer.from(recibida, 'hex'));
}

/** Compara dos textos sin filtrar por tiempo en qué carácter difieren. */
export function igualesSinFiltrarTiempo(a: string, b: string): boolean {
  const hashA = createHmac('sha256', CLAVE_DE_COMPARACION).update(a).digest();
  const hashB = createHmac('sha256', CLAVE_DE_COMPARACION).update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * La verificación del webhook (GET con `hub.*`): devuelve el challenge si el
 * token es el nuestro. El challenge vuelve tal cual en la respuesta, así que
 * sólo se acepta si es un texto corto y sin caracteres raros.
 */
export function challengeDeVerificacion(
  query: Record<string, unknown>,
  tokenEsperado: string,
): string | null {
  const modo = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (!tokenEsperado || modo !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
  if (!/^[\w-]{1,200}$/.test(challenge)) return null;
  return igualesSinFiltrarTiempo(token, tokenEsperado) ? challenge : null;
}
