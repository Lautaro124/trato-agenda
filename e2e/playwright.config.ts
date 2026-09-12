import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './entorno';

/**
 * E2E de Trato Agenda. No levanta servidores: corre contra el stack de
 * docker compose con el override de e2e (ver README, "Tests E2E").
 *
 * Proyectos:
 * - escritorio: todo lo que no está etiquetado @movil ni @real.
 * - movil: sólo @movil (el formulario de /contanos en una sola pantalla).
 * - real: sólo @real, contra OpenRouter de verdad (`npm run e2e:real`).
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
      grepInvert: /@movil|@real/,
    },
    {
      name: 'movil',
      use: { ...devices['Pixel 7'] },
      grep: /@movil/,
    },
    {
      name: 'real',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } },
      grep: /@real/,
      timeout: 180_000,
    },
  ],
});
