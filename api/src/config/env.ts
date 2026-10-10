/** Variables de entorno que la API necesita sí o sí para arrancar. */
export type Env = {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_CALLBACK_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  TOKEN_ENCRYPTION_KEY: string;
  FRONTEND_URL: string;
  SESSION_COOKIE_NAME: string;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;
  /** Base del endpoint OpenAI-compatible. Los E2E la apuntan a un OpenRouter falso. */
  OPENROUTER_BASE_URL: string;
  /**
   * Modelo de embeddings del catálogo de ventas. Tiene que tener endpoint ZDR
   * y dar vectores de 1536 dimensiones (la columna Producto.embedding).
   */
  OPENROUTER_EMBEDDINGS_MODEL: string;
  /**
   * Modelo de decisiones (no de chat) con el que el asistente de ventas elige
   * qué categorías o productos sugerir: Jev, de TypeSafe. Tiene que tener
   * endpoint ZDR, igual que los otros dos.
   */
  OPENROUTER_DECISIONS_MODEL: string;
  /** La Decisions API de OpenRouter no cuelga de /api/v1. Los E2E la apuntan al stub. */
  OPENROUTER_DECISIONS_URL: string;
  /** Contraseña del login de desarrollo. Vacía = login dev apagado. Prohibida en producción. */
  DEV_LOGIN_PASSWORD: string;
  MERCADOPAGO_ACCESS_TOKEN: string;
  MERCADOPAGO_WEBHOOK_SECRET: string;
  /**
   * OAuth de la misma aplicación de Mercado Pago: con esto cada comercio
   * conecta su cuenta y el asistente de ventas cobra a su nombre.
   */
  MERCADOPAGO_CLIENT_ID: string;
  MERCADOPAGO_CLIENT_SECRET: string;
  /** Base de la API de Mercado Pago. Los E2E la apuntan a un Mercado Pago falso. */
  MERCADOPAGO_BASE_URL: string;
  /** Dónde se autoriza el OAuth (la pantalla de Mercado Pago). Los E2E también la reemplazan. */
  MERCADOPAGO_AUTH_URL: string;
  /**
   * URL pública de la propia API: el redirect del OAuth de Mercado Pago y el
   * notification_url de los links de pago. Por defecto, el origen de
   * GOOGLE_CALLBACK_URL, que ya es la API.
   */
  API_PUBLIC_URL: string;
  SUSCRIPCION_PRECIO_ARS: number;
  /**
   * Hasta cuánto para atrás ve el modelo el historial de un chat
   * (HISTORIAL_IA_VENTANA, "14d", "1d", "2h", "30m"). Lo más viejo sigue en
   * la base; sólo deja de mandarse al modelo.
   */
  HISTORIAL_IA_VENTANA_MS: number;
};

const REQUIRED = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'JWT_SECRET',
  'TOKEN_ENCRYPTION_KEY',
] as const;
// OPENROUTER_API_KEY no está en REQUIRED a propósito: sin ella la API arranca
// igual (login y vinculación de WhatsApp no la necesitan), pero
// OpenRouterClient falla con un error claro apenas se intenta generar un
// agente o procesar un mensaje. Lo mismo vale para las MERCADOPAGO_*: sin
// ellas el producto funciona entero durante el mes de prueba y sólo falla al
// intentar suscribirse, o (las de OAuth) al conectar Mercado Pago para vender.

export const OPENROUTER_BASE_URL_POR_DEFECTO = 'https://openrouter.ai/api/v1';
export const OPENROUTER_DECISIONS_URL_POR_DEFECTO = 'https://openrouter.ai/api/alpha/decisions';
export const MERCADOPAGO_BASE_URL_POR_DEFECTO = 'https://api.mercadopago.com';

export const HISTORIAL_IA_VENTANA_POR_DEFECTO = '14d';

const MS_POR_UNIDAD = { m: 60_000, h: 60 * 60_000, d: 24 * 60 * 60_000 } as const;

/** Más de diez años no es una ventana, es un error de tipeo (y saca la fecha de rango). */
const DURACION_MAXIMA_MS = 3650 * MS_POR_UNIDAD.d;

/** "14d" → milisegundos. Minutos, horas o días enteros, mayores a cero y hasta diez años; si no, null. */
export function parsearDuracion(texto: string): number | null {
  const coincidencia = /^(\d+)\s*([mhd])$/i.exec(texto.trim());
  if (!coincidencia) return null;
  const cantidad = Number(coincidencia[1]);
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) return null;
  const ms = cantidad * MS_POR_UNIDAD[coincidencia[2].toLowerCase() as keyof typeof MS_POR_UNIDAD];
  return ms <= DURACION_MAXIMA_MS ? ms : null;
}

/** Saca las barras finales de una URL. Sin regex: `/\/+$/` hace backtracking cuadrático. */
function sinBarrasFinales(url: string): string {
  let fin = url.length;
  while (fin > 0 && url[fin - 1] === '/') fin--;
  return url.slice(0, fin);
}

function origenDe(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * Validación de entorno: mejor romper al arrancar que descubrir a mitad
 * del flujo de OAuth que falta una credencial.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const faltantes = REQUIRED.filter((clave) => !raw[clave]);
  if (faltantes.length > 0) {
    throw new Error(
      `Faltan variables de entorno: ${faltantes.join(', ')}. Definilas en api/.env (ver la tabla de variables en el README de la raíz).`,
    );
  }

  const claveHex = String(raw.TOKEN_ENCRYPTION_KEY);
  if (!/^[0-9a-fA-F]{64}$/.test(claveHex)) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY tiene que ser 32 bytes en hexadecimal (64 caracteres). Generala con: openssl rand -hex 32',
    );
  }

  if (String(raw.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET tiene que tener al menos 32 caracteres.');
  }

  const nodeEnv = (raw.NODE_ENV as Env['NODE_ENV']) ?? 'development';
  const devLoginPassword = String(raw.DEV_LOGIN_PASSWORD ?? '');
  // El login con contraseña saltea Google entero: si alguien la deja puesta en
  // Railway, mejor que el deploy no arranque a que quede una puerta abierta.
  if (nodeEnv === 'production' && devLoginPassword) {
    throw new Error('DEV_LOGIN_PASSWORD no puede estar definida en producción. Borrala de las variables del deploy.');
  }

  const ventanaHistorial = String(raw.HISTORIAL_IA_VENTANA || HISTORIAL_IA_VENTANA_POR_DEFECTO);
  const ventanaHistorialMs = parsearDuracion(ventanaHistorial);
  if (ventanaHistorialMs === null) {
    throw new Error(
      `HISTORIAL_IA_VENTANA tiene que ser un número entero seguido de m, h o d (por ejemplo 14d, 1d o 2h); vino "${ventanaHistorial}".`,
    );
  }

  return {
    NODE_ENV: nodeEnv,
    PORT: Number(raw.PORT ?? 4000),
    DATABASE_URL: String(raw.DATABASE_URL),
    GOOGLE_CLIENT_ID: String(raw.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: String(raw.GOOGLE_CLIENT_SECRET),
    GOOGLE_CALLBACK_URL: String(raw.GOOGLE_CALLBACK_URL),
    JWT_SECRET: String(raw.JWT_SECRET),
    JWT_EXPIRES_IN: String(raw.JWT_EXPIRES_IN ?? '7d'),
    TOKEN_ENCRYPTION_KEY: claveHex,
    FRONTEND_URL: String(raw.FRONTEND_URL ?? 'http://localhost:3000'),
    SESSION_COOKIE_NAME: String(raw.SESSION_COOKIE_NAME ?? 'trato_session'),
    OPENROUTER_API_KEY: String(raw.OPENROUTER_API_KEY ?? ''),
    OPENROUTER_MODEL: String(raw.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it'),
    OPENROUTER_BASE_URL: sinBarrasFinales(String(raw.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL_POR_DEFECTO)),
    OPENROUTER_EMBEDDINGS_MODEL: String(raw.OPENROUTER_EMBEDDINGS_MODEL || 'openai/text-embedding-3-small'),
    OPENROUTER_DECISIONS_MODEL: String(raw.OPENROUTER_DECISIONS_MODEL || 'typesafe/jev-1.13'),
    OPENROUTER_DECISIONS_URL: sinBarrasFinales(String(raw.OPENROUTER_DECISIONS_URL || OPENROUTER_DECISIONS_URL_POR_DEFECTO)),
    DEV_LOGIN_PASSWORD: devLoginPassword,
    MERCADOPAGO_ACCESS_TOKEN: String(raw.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    MERCADOPAGO_WEBHOOK_SECRET: String(raw.MERCADOPAGO_WEBHOOK_SECRET ?? ''),
    MERCADOPAGO_CLIENT_ID: String(raw.MERCADOPAGO_CLIENT_ID ?? ''),
    MERCADOPAGO_CLIENT_SECRET: String(raw.MERCADOPAGO_CLIENT_SECRET ?? ''),
    MERCADOPAGO_BASE_URL: sinBarrasFinales(String(raw.MERCADOPAGO_BASE_URL || MERCADOPAGO_BASE_URL_POR_DEFECTO)),
    MERCADOPAGO_AUTH_URL: sinBarrasFinales(String(raw.MERCADOPAGO_AUTH_URL || 'https://auth.mercadopago.com')),
    API_PUBLIC_URL: sinBarrasFinales(String(raw.API_PUBLIC_URL || origenDe(String(raw.GOOGLE_CALLBACK_URL)))),
    SUSCRIPCION_PRECIO_ARS: Number(raw.SUSCRIPCION_PRECIO_ARS ?? 20000),
    HISTORIAL_IA_VENTANA_MS: ventanaHistorialMs,
  };
}
