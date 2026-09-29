import type { Breadcrumb, Event, NodeOptions } from '@sentry/nestjs';

/** Span tal como lo recibe `beforeSendSpan` (modo stream, el default desde la v11). */
export type SpanEnStream = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0];

/**
 * Limpieza de todo lo que sale hacia Sentry. Funciones puras, como
 * agenda-rules.ts, para poder testearlas sin inicializar el SDK.
 *
 * `dataCollection` (en instrument.ts) ya apaga cookies, bodies y variables
 * locales, pero no alcanza: los
 * mensajes de error llevan lo que cada uno quiso loguear, y las URLs de las
 * llamadas salientes pueden traer tokens en la query (la revocación de Google,
 * por ejemplo). Lo que declaramos en /privacidad es que a Sentry no llegan
 * conversaciones, teléfonos ni emails; esto es lo que lo garantiza.
 */

/** Largo máximo de cualquier texto que viaje: un error de proveedor puede repetir el prompt entero. */
export const MAX_TEXTO = 500;

/** Cabeceras que se conservan del request; el resto (cookie, authorization, x-signature...) no sale. */
const CABECERAS_PERMITIDAS = new Set(['user-agent', 'content-type', 'content-length']);

/** Categorías de breadcrumb que se descartan enteras: la consola puede tener cualquier cosa. */
const CATEGORIAS_DESCARTADAS = new Set(['console']);

const EMAIL = /[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[^\s@"'<>()[\]]+/g;
// Teléfonos con prefijo internacional escritos con espacios o guiones, y
// cualquier corrida de 8+ dígitos (los JID de WhatsApp, 5491122334455). Se
// llevan también algún timestamp en milisegundos: preferible a dejar pasar un número.
const TELEFONO = /\+\d[\d\s-]{6,}\d|\d{8,}/g;
const QUERY = /\?[^\s#"']*/g;

export function limpiarTexto(texto: string): string {
  const limpio = texto.replace(EMAIL, '[email]').replace(TELEFONO, '[tel]');
  return limpio.length > MAX_TEXTO ? `${limpio.slice(0, MAX_TEXTO)}…` : limpio;
}

/** Saca la query (y con ella tokens, teléfonos y códigos) de cualquier URL dentro del texto. */
export function sinQuery(texto: string): string {
  return texto.replace(QUERY, '');
}

function esClaveDeUrl(clave: string): boolean {
  return /url|target|route|path/i.test(clave);
}

function limpiarValor(clave: string, valor: string): string {
  return limpiarTexto(esClaveDeUrl(clave) ? sinQuery(valor) : valor);
}

/**
 * Limpia un mapa de datos (de breadcrumb o de span) sin mutar el original.
 * Los atributos de span pueden venir como `{ value, unit }`: también se limpian.
 */
export function limpiarDatos<T extends Record<string, unknown>>(datos: T | undefined): T | undefined {
  if (!datos) return datos;
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (/query|fragment|body|cookie|authorization/i.test(clave)) continue;
    if (typeof valor === 'string') {
      salida[clave] = limpiarValor(clave, valor);
    } else if (valor && typeof valor === 'object' && 'value' in valor && typeof valor.value === 'string') {
      salida[clave] = { ...valor, value: limpiarValor(clave, valor.value) };
    } else {
      salida[clave] = valor;
    }
  }
  return salida as T;
}

export function limpiarBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category && CATEGORIAS_DESCARTADAS.has(breadcrumb.category)) return null;
  return {
    ...breadcrumb,
    message: breadcrumb.message === undefined ? undefined : limpiarTexto(sinQuery(breadcrumb.message)),
    data: limpiarDatos(breadcrumb.data),
  };
}

function limpiarRequest(request: Event['request']): Event['request'] {
  if (!request) return request;
  const headers: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(request.headers ?? {})) {
    if (CABECERAS_PERMITIDAS.has(nombre.toLowerCase())) headers[nombre] = valor;
  }
  return {
    method: request.method,
    url: request.url === undefined ? undefined : sinQuery(request.url),
    headers,
  };
}

/**
 * Limpia un evento (error o transacción) antes de mandarlo. No muta el
 * original: devuelve una copia con lo mínimo para diagnosticar.
 */
export function limpiarEvento<T extends Event>(evento: T): T {
  const limpio: T = { ...evento };

  if (limpio.message !== undefined) limpio.message = limpiarTexto(limpio.message);
  if (limpio.request) limpio.request = limpiarRequest(limpio.request);
  // De la persona sólo el id interno: nunca email, IP ni nombre.
  if (limpio.user) limpio.user = limpio.user.id === undefined ? undefined : { id: limpio.user.id };
  if (limpio.transaction !== undefined) limpio.transaction = sinQuery(limpio.transaction);

  if (limpio.exception?.values) {
    limpio.exception = {
      ...limpio.exception,
      values: limpio.exception.values.map((valor) => ({
        ...valor,
        value: valor.value === undefined ? undefined : limpiarTexto(valor.value),
        // Las variables locales de cada frame pueden tener la conversación o un
        // token: dataCollection ya las apaga, esto es por si vuelven.
        stacktrace: valor.stacktrace && {
          ...valor.stacktrace,
          frames: valor.stacktrace.frames?.map(({ vars: _vars, ...frame }) => frame),
        },
      })),
    };
  }

  if (limpio.breadcrumbs) {
    limpio.breadcrumbs = limpio.breadcrumbs
      .map(limpiarBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  }

  if (limpio.extra) limpio.extra = limpiarDatos(limpio.extra);

  const traza = limpio.contexts?.trace;
  if (traza?.data) {
    limpio.contexts = { ...limpio.contexts, trace: { ...traza, data: limpiarDatos(traza.data) } };
  }

  return limpio;
}

/**
 * Limpia cada span antes de mandarlo. El nombre de un span saliente es
 * `GET https://…?token=…` y sus atributos llevan la URL completa: sin esto, la
 * revocación del token de Google o una búsqueda por teléfono viajarían tal cual.
 */
export function limpiarSpan(span: SpanEnStream): SpanEnStream {
  return {
    ...span,
    name: limpiarTexto(sinQuery(span.name)),
    attributes: limpiarDatos(span.attributes) ?? span.attributes,
  };
}
