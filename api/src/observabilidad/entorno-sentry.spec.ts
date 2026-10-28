import { afterEach, describe, expect, it, vi } from 'vitest';

const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('@sentry/nestjs', () => ({ init }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('entorno de Sentry', () => {
  it.each([
    ['production', '', 'production', 0.1],
    ['develop', '', 'develop', 0],
    ['', '', 'local', 0],
    ['production', 'local', 'local', 0],
  ])('Railway=%s, explícito=%s → %s', async (railway, explicito, esperado, trazas) => {
    vi.resetModules();
    vi.stubEnv('SENTRY_DSN', 'https://public@example.com/1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', railway);
    vi.stubEnv('SENTRY_ENVIRONMENT', explicito);
    vi.stubEnv('SENTRY_TRACES_SAMPLE_RATE', '');
    await import('../instrument.js');
    expect(init).toHaveBeenCalledWith(expect.objectContaining({
      environment: esperado,
      tracesSampleRate: trazas,
      initialScope: { tags: { servicio: 'api' } },
    }));
  });

  it('no inicializa el SDK sin DSN', async () => {
    vi.resetModules();
    vi.stubEnv('SENTRY_DSN', '');
    await import('../instrument.js');
    expect(init).not.toHaveBeenCalled();
  });
});
