import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

/** Entorno mínimo válido; cada test pisa sólo lo que le interesa. */
function base(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@db:5432/trato',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
    JWT_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_KEY: 'b'.repeat(64),
    ...extra,
  };
}

describe('validateEnv — cookie de sesión', () => {
  it('por defecto usa lax y no fuerza secure fuera de producción', () => {
    const env = validateEnv(base());

    expect(env.COOKIE_SAMESITE).toBe('lax');
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('en producción marca la cookie como secure sin pedirlo', () => {
    const env = validateEnv(base({ NODE_ENV: 'production' }));

    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('acepta none + secure, que es lo que necesita un front en otro site', () => {
    const env = validateEnv(base({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'true' }));

    expect(env.COOKIE_SAMESITE).toBe('none');
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('rechaza none sin secure: el navegador descartaría la cookie', () => {
    expect(() => validateEnv(base({ COOKIE_SAMESITE: 'none', COOKIE_SECURE: 'false' }))).toThrow(
      /COOKIE_SECURE=true/,
    );
  });

  it('rechaza none en desarrollo, donde secure no aplica por defecto', () => {
    expect(() => validateEnv(base({ COOKIE_SAMESITE: 'none' }))).toThrow(/COOKIE_SECURE=true/);
  });

  it('rechaza un sameSite que el navegador no entiende', () => {
    expect(() => validateEnv(base({ COOKIE_SAMESITE: 'siempre' }))).toThrow(/COOKIE_SAMESITE/);
  });

  it('permite apagar secure a mano en producción detrás de un proxy propio', () => {
    const env = validateEnv(base({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }));

    expect(env.COOKIE_SECURE).toBe(false);
  });
});
