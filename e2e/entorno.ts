/**
 * Dónde vive cada pieza del stack. Los defaults son los puertos de
 * docker-compose.yml + docker-compose.e2e.yml; se pisan por variable de
 * entorno para correr contra otro lado.
 */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
export const STUB_URL = process.env.E2E_STUB_URL ?? 'http://localhost:4010';

/** La de docker-compose.e2e.yml. Para `e2e:real`, la que tenga api/.env. */
export const DEV_PASSWORD = process.env.E2E_DEV_PASSWORD ?? 'e2e-password';

/** `npm run e2e:real`: sin OpenRouter falso, contra el modelo configurado en api/.env. */
export const MODO_REAL = process.env.E2E_REAL === '1';
