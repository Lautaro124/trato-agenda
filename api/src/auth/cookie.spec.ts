import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { opcionesDeCookie } from './cookie.js';

function config(valores: Partial<Record<keyof Env, string>>): ConfigService<Env, true> {
  return {
    get: (clave: string) => (valores as Record<string, string>)[clave],
  } as unknown as ConfigService<Env, true>;
}

describe('opcionesDeCookie', () => {
  it('usa lax cuando la API es subdominio del front (dominio propio)', () => {
    const opciones = opcionesDeCookie(
      config({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://tratoagenda.com',
        GOOGLE_CALLBACK_URL: 'https://api.tratoagenda.com/auth/google/callback',
      }),
    );

    expect(opciones.sameSite).toBe('lax');
    expect(opciones.secure).toBe(true);
    expect(opciones.httpOnly).toBe(true);
  });

  it('usa lax en local, donde front y API comparten host y sólo cambia el puerto', () => {
    const opciones = opcionesDeCookie(
      config({
        NODE_ENV: 'development',
        FRONTEND_URL: 'http://localhost:3000',
        GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
      }),
    );

    expect(opciones.sameSite).toBe('lax');
    expect(opciones.secure).toBe(false);
  });

  it('cae en none con dos subdominios hermanos de un sufijo público', () => {
    // `up.railway.app` está en la Public Suffix List: comparten "railway.app"
    // pero no son el mismo sitio, y darlos por iguales rompería el login.
    const opciones = opcionesDeCookie(
      config({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://web-production-8d1ba.up.railway.app',
        GOOGLE_CALLBACK_URL: 'https://api-production-a4a0.up.railway.app/auth/google/callback',
      }),
    );

    expect(opciones.sameSite).toBe('none');
    expect(opciones.secure).toBe(true);
  });

  it('cae en none si alguna URL no parsea', () => {
    const opciones = opcionesDeCookie(
      config({ NODE_ENV: 'production', FRONTEND_URL: 'no-es-una-url', GOOGLE_CALLBACK_URL: '' }),
    );

    expect(opciones.sameSite).toBe('none');
  });
});
