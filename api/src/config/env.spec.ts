import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const BASE = {
  DATABASE_URL: 'postgresql://postgres:postgres@db:5432/trato',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
  JWT_SECRET: 'x'.repeat(32),
  TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('validateEnv', () => {
  it('permite DEV_LOGIN_PASSWORD en desarrollo', () => {
    const env = validateEnv({ ...BASE, NODE_ENV: 'development', DEV_LOGIN_PASSWORD: 'secreta' });

    expect(env.DEV_LOGIN_PASSWORD).toBe('secreta');
  });

  it('no arranca en producción si DEV_LOGIN_PASSWORD está definida', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', DEV_LOGIN_PASSWORD: 'secreta' })).toThrow(
      /DEV_LOGIN_PASSWORD/,
    );
  });

  it('en producción sin DEV_LOGIN_PASSWORD arranca normal', () => {
    expect(validateEnv({ ...BASE, NODE_ENV: 'production' }).DEV_LOGIN_PASSWORD).toBe('');
  });

  it('OPENROUTER_BASE_URL por defecto apunta a OpenRouter y se le saca la barra final', () => {
    expect(validateEnv(BASE).OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(validateEnv({ ...BASE, OPENROUTER_BASE_URL: 'http://openrouter-stub:4010/api/v1/' }).OPENROUTER_BASE_URL).toBe(
      'http://openrouter-stub:4010/api/v1',
    );
  });

  it('OPENROUTER_MODEL_AGENTES es opcional', () => {
    expect(validateEnv(BASE).OPENROUTER_MODEL_AGENTES).toBe('');
    expect(validateEnv({ ...BASE, OPENROUTER_MODEL_AGENTES: 'google/gemma-4-26b-a4b-it:nitro' }).OPENROUTER_MODEL_AGENTES).toBe(
      'google/gemma-4-26b-a4b-it:nitro',
    );
  });
});
