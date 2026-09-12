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
  /** Modelo sólo para generar agentes. Vacío = usa OPENROUTER_MODEL. */
  OPENROUTER_MODEL_AGENTES: string;
  /** Base del endpoint OpenAI-compatible. Los E2E la apuntan a un OpenRouter falso. */
  OPENROUTER_BASE_URL: string;
  /** Contraseña del login de desarrollo. Vacía = login dev apagado. Prohibida en producción. */
  DEV_LOGIN_PASSWORD: string;
  MERCADOPAGO_ACCESS_TOKEN: string;
  MERCADOPAGO_WEBHOOK_SECRET: string;
  SUSCRIPCION_PRECIO_ARS: number;
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
// intentar suscribirse.

export const OPENROUTER_BASE_URL_POR_DEFECTO = 'https://openrouter.ai/api/v1';

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
    OPENROUTER_MODEL_AGENTES: String(raw.OPENROUTER_MODEL_AGENTES ?? ''),
    OPENROUTER_BASE_URL: String(raw.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL_POR_DEFECTO).replace(/\/+$/, ''),
    DEV_LOGIN_PASSWORD: devLoginPassword,
    MERCADOPAGO_ACCESS_TOKEN: String(raw.MERCADOPAGO_ACCESS_TOKEN ?? ''),
    MERCADOPAGO_WEBHOOK_SECRET: String(raw.MERCADOPAGO_WEBHOOK_SECRET ?? ''),
    SUSCRIPCION_PRECIO_ARS: Number(raw.SUSCRIPCION_PRECIO_ARS ?? 20000),
  };
}
