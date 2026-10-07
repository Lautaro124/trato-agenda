import { describe, expect, it } from 'vitest';
import { parsearDuracion, validateEnv } from './env.js';

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

  it('OPENROUTER_EMBEDDINGS_MODEL por defecto es el modelo ZDR de 1536 dimensiones', () => {
    expect(validateEnv(BASE).OPENROUTER_EMBEDDINGS_MODEL).toBe('openai/text-embedding-3-small');
    expect(validateEnv({ ...BASE, OPENROUTER_EMBEDDINGS_MODEL: 'otro/modelo' }).OPENROUTER_EMBEDDINGS_MODEL).toBe(
      'otro/modelo',
    );
  });

  it('las sugerencias de ventas usan Jev por la Decisions API de OpenRouter, reemplazable para los E2E', () => {
    expect(validateEnv(BASE).OPENROUTER_DECISIONS_MODEL).toBe('typesafe/jev-1.13');
    expect(validateEnv(BASE).OPENROUTER_DECISIONS_URL).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(
      validateEnv({ ...BASE, OPENROUTER_DECISIONS_URL: 'http://openrouter-stub:4010/api/alpha/decisions/' }).OPENROUTER_DECISIONS_URL,
    ).toBe('http://openrouter-stub:4010/api/alpha/decisions');
  });

  it('API_PUBLIC_URL sale del origen de GOOGLE_CALLBACK_URL si no se define', () => {
    const conCallback = { ...BASE, GOOGLE_CALLBACK_URL: 'https://api.tratoagenda.com/auth/google/callback' };
    expect(validateEnv(conCallback).API_PUBLIC_URL).toBe('https://api.tratoagenda.com');
    expect(validateEnv({ ...conCallback, API_PUBLIC_URL: 'https://otra.api/' }).API_PUBLIC_URL).toBe('https://otra.api');
  });

  it('MERCADOPAGO_BASE_URL por defecto es la API real', () => {
    expect(validateEnv(BASE).MERCADOPAGO_BASE_URL).toBe('https://api.mercadopago.com');
  });

  it('la ventana de historial para el modelo es de 14 días si no se configura', () => {
    expect(validateEnv(BASE).HISTORIAL_IA_VENTANA_MS).toBe(14 * 24 * 60 * 60_000);
  });

  it('acepta la ventana de historial en días, horas o minutos', () => {
    expect(validateEnv({ ...BASE, HISTORIAL_IA_VENTANA: '1d' }).HISTORIAL_IA_VENTANA_MS).toBe(24 * 60 * 60_000);
    expect(validateEnv({ ...BASE, HISTORIAL_IA_VENTANA: '2h' }).HISTORIAL_IA_VENTANA_MS).toBe(2 * 60 * 60_000);
    expect(validateEnv({ ...BASE, HISTORIAL_IA_VENTANA: '30m' }).HISTORIAL_IA_VENTANA_MS).toBe(30 * 60_000);
  });

  it('no arranca con una ventana de historial mal escrita', () => {
    for (const valor of ['14', 'dos semanas', '0d', '-1d', '1.5h', '2w', '9999999999d']) {
      expect(() => validateEnv({ ...BASE, HISTORIAL_IA_VENTANA: valor })).toThrow(/HISTORIAL_IA_VENTANA/);
    }
  });
});

describe('parsearDuracion', () => {
  it('ignora mayúsculas y espacios', () => {
    expect(parsearDuracion(' 2H ')).toBe(2 * 60 * 60_000);
    expect(parsearDuracion('7 d')).toBe(7 * 24 * 60 * 60_000);
  });
});
