import * as Sentry from '@sentry/nestjs';
import { limpiarBreadcrumb, limpiarEvento, limpiarSpan } from './observabilidad/scrubbing.js';

/**
 * Inicialización de Sentry. Se carga con `node --import ./dist/instrument.js`
 * antes que main.js: en ESM es la única forma de que el SDK enganche express,
 * http y pg antes de que se importen. Por eso lee `process.env` directo y no
 * pasa por ConfigModule, que todavía no existe a esta altura.
 *
 * Sin SENTRY_DSN no hace nada: dev, CI y E2E quedan como estaban.
 */

/**
 * Integraciones que instrumentan llamadas a modelos. Se sacan todas aunque
 * `dataCollection.genAI` ya les impida guardar los prompts: los prompts llevan la
 * conversación del cliente y datos del Google Calendar del dueño, y eso sólo
 * puede ir a OpenRouter con ZDR (ver /privacidad y docs/verificacion-google.md).
 * No depender de un default del SDK que puede cambiar en una versión.
 */
export const INTEGRACIONES_DE_IA = new Set([
  'OpenAI',
  'LangChain',
  'LangGraph',
  'Anthropic_AI',
  'Google_GenAI',
  'Groq',
  'Mistral',
  'Mastra',
  'VercelAI',
  'WorkersAI',
  'TogetherAI',
  'Flue',
  // No son de IA, pero leen las variables locales de cada frame (la
  // conversación, un token): dataCollection ya las apaga, esto es por si vuelven.
  'LocalVariables',
  'LocalVariablesAsync',
]);

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const produccion = process.env.NODE_ENV === 'production';
  Sentry.init({
    dsn,
    // Los dos entornos de Railway corren con NODE_ENV=production: sin el
    // nombre del entorno, los eventos de develop y de producción se mezclan.
    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.NODE_ENV ||
      'development',
    // Railway la define en cada deploy: los errores quedan atados al commit.
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    // Desde la v11 el default es recolectar todo (bodies, cookies, variables
    // locales de cada frame, entradas y salidas de los modelos, parámetros de
    // las queries). Acá va todo apagado: sólo headers inocuos. limpiarEvento
    // vuelve a filtrar por si una versión futura agrega otra categoría.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['user-agent', 'content-type', 'content-length'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || (produccion ? 0.1 : 0)),
    integrations: (porDefecto) => porDefecto.filter((integracion) => !INTEGRACIONES_DE_IA.has(integracion.name)),
    beforeSend: (evento) => limpiarEvento(evento),
    // Las trazas viajan span por span (traceLifecycle 'stream', el default):
    // beforeSendTransaction ya no corre, la limpieza va acá.
    beforeSendSpan: (span) => limpiarSpan(span),
    beforeBreadcrumb: (breadcrumb) => limpiarBreadcrumb(breadcrumb),
  });
}
