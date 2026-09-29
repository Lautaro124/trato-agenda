import type { Breadcrumb, Event } from "@sentry/nextjs";

/**
 * Configuración de Sentry compartida por el browser (instrumentation-client.ts)
 * y el server de Next (instrumentation.ts). Sin NEXT_PUBLIC_SENTRY_DSN, que se
 * inlinea en el build como NEXT_PUBLIC_API_URL, no se inicializa nada.
 *
 * La limpieza es una copia chica de api/src/observabilidad/scrubbing.ts (los
 * dos paquetes no comparten código y la web no tiene test runner: los tests
 * viven allá). Lo que /privacidad promete es que a Sentry no llegan
 * conversaciones, teléfonos ni emails; si cambia una, cambia la otra.
 */

export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

const MAX_TEXTO = 500;
const EMAIL = /[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[^\s@"'<>()[\]]+/g;
const TELEFONO = /\+\d[\d\s-]{6,}\d|\d{8,}/g;
const QUERY = /\?[^\s#"']*/g;

function limpiarTexto(texto: string): string {
  const limpio = texto.replace(EMAIL, "[email]").replace(TELEFONO, "[tel]");
  return limpio.length > MAX_TEXTO ? `${limpio.slice(0, MAX_TEXTO)}…` : limpio;
}

function sinQuery(texto: string): string {
  return texto.replace(QUERY, "");
}

function limpiarDatos<T extends Record<string, unknown>>(datos: T | undefined): T | undefined {
  if (!datos) return datos;
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (/query|fragment|body|cookie|authorization/i.test(clave)) continue;
    const esUrl = /url|target|route|path|from|to/i.test(clave);
    const limpiar = (texto: string) => limpiarTexto(esUrl ? sinQuery(texto) : texto);
    if (typeof valor === "string") salida[clave] = limpiar(valor);
    else if (valor && typeof valor === "object" && "value" in valor && typeof valor.value === "string")
      salida[clave] = { ...valor, value: limpiar(valor.value) };
    else salida[clave] = valor;
  }
  return salida as T;
}

export function limpiarBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // La consola puede tener cualquier cosa; los clicks traen el texto de la
  // pantalla (nombres de clientes, productos).
  if (breadcrumb.category === "console" || breadcrumb.category?.startsWith("ui.")) return null;
  return {
    ...breadcrumb,
    message: breadcrumb.message === undefined ? undefined : limpiarTexto(sinQuery(breadcrumb.message)),
    data: limpiarDatos(breadcrumb.data),
  };
}

export function limpiarEvento<T extends Event>(evento: T): T {
  const limpio: T = { ...evento };
  if (limpio.message !== undefined) limpio.message = limpiarTexto(limpio.message);
  if (limpio.request) {
    limpio.request = {
      method: limpio.request.method,
      url: limpio.request.url === undefined ? undefined : sinQuery(limpio.request.url),
    };
  }
  if (limpio.user) limpio.user = limpio.user.id === undefined ? undefined : { id: limpio.user.id };
  if (limpio.transaction !== undefined) limpio.transaction = sinQuery(limpio.transaction);
  if (limpio.exception?.values) {
    limpio.exception = {
      ...limpio.exception,
      values: limpio.exception.values.map((valor) => ({
        ...valor,
        value: valor.value === undefined ? undefined : limpiarTexto(valor.value),
      })),
    };
  }
  if (limpio.breadcrumbs) {
    limpio.breadcrumbs = limpio.breadcrumbs
      .map(limpiarBreadcrumb)
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  }
  if (limpio.extra) limpio.extra = limpiarDatos(limpio.extra);
  return limpio;
}

export function limpiarSpan<T extends { name: string; attributes: Record<string, unknown> }>(span: T): T {
  return { ...span, name: limpiarTexto(sinQuery(span.name)), attributes: limpiarDatos(span.attributes) ?? span.attributes };
}

/** Opciones comunes a los tres runtimes (browser, Node y edge). */
export const opcionesDeSentry = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_DSN !== "",
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  // Errores siempre; trazas de una muestra en producción.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  // Desde la v11 el SDK recolecta todo por defecto: acá va todo apagado.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
  beforeSend: limpiarEvento,
  beforeBreadcrumb: limpiarBreadcrumb,
  beforeSendSpan: limpiarSpan,
};
