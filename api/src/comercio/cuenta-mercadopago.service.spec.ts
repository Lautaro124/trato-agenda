import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { decryptToken, encryptToken } from '../auth/token-crypto.js';
import type { Env } from '../config/env.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { MercadoPagoClient } from '../subscription/mercadopago.client.js';
import { ConexionInvalidaError, CuentaMercadoPagoService } from './cuenta-mercadopago.service.js';

const CLAVE = 'a'.repeat(64);
const DIA = 24 * 60 * 60 * 1000;
const AHORA = Date.parse('2026-09-26T12:00:00Z');

const TOKENS = { access_token: 'APP_USR-nuevo', refresh_token: 'TG-nuevo', expires_in: 180 * 24 * 60 * 60, user_id: 777 };

function crear(cuentaGuardada: Record<string, unknown> | null = null) {
  const valores: Record<string, string> = {
    MERCADOPAGO_CLIENT_ID: 'app-1',
    MERCADOPAGO_CLIENT_SECRET: 'secreto',
    MERCADOPAGO_AUTH_URL: 'https://auth.mercadopago.com',
    API_PUBLIC_URL: 'https://api.tratoagenda.com',
    TOKEN_ENCRYPTION_KEY: CLAVE,
  };
  const config = { get: (clave: string) => valores[clave] } as unknown as ConfigService<Env, true>;
  const upsert = vi.fn(async ({ create }: { create: Record<string, unknown> }) => create);
  const prisma = {
    cuentaMercadoPago: {
      findUnique: vi.fn().mockResolvedValue(cuentaGuardada),
      upsert,
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
  const mp = {
    canjearCodigo: vi.fn().mockResolvedValue(TOKENS),
    refrescarToken: vi.fn().mockResolvedValue(TOKENS),
  } as unknown as MercadoPagoClient & { canjearCodigo: ReturnType<typeof vi.fn>; refrescarToken: ReturnType<typeof vi.fn> };
  return { servicio: new CuentaMercadoPagoService(prisma, mp, config), mp, upsert };
}

function paramsDe(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('CuentaMercadoPagoService', () => {
  it('arma la URL de autorización con PKCE S256 y el redirect de la API', () => {
    const { servicio } = crear();
    const url = servicio.iniciarConexion('user-1', AHORA);
    expect(url.startsWith('https://auth.mercadopago.com/authorization?')).toBe(true);
    const params = paramsDe(url);
    expect(params.get('client_id')).toBe('app-1');
    expect(params.get('redirect_uri')).toBe('https://api.tratoagenda.com/mercadopago/callback');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('state')?.length).toBeGreaterThanOrEqual(40);
  });

  it('canjea el código con el verificador que corresponde al desafío y guarda los tokens cifrados', async () => {
    const { servicio, mp, upsert } = crear();
    const params = paramsDe(servicio.iniciarConexion('user-1', AHORA));

    await servicio.completarConexion('user-1', params.get('state')!, 'TG-code', AHORA);

    const [{ codeVerifier, code }] = mp.canjearCodigo.mock.calls[0] as [{ codeVerifier: string; code: string }];
    expect(code).toBe('TG-code');
    const desafio = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(desafio).toBe(params.get('code_challenge'));

    const [{ create }] = upsert.mock.calls[0] as unknown as [{ create: Record<string, string | Date> }];
    expect(create.mpUserId).toBe('777');
    expect(create.accessToken).not.toContain('APP_USR');
    expect(decryptToken(String(create.accessToken), CLAVE)).toBe('APP_USR-nuevo');
    expect(create.expiraAt).toEqual(new Date(AHORA + 180 * DIA));
  });

  it('rechaza un state de otro usuario, vencido o repetido', async () => {
    const { servicio, mp } = crear();
    const state = paramsDe(servicio.iniciarConexion('user-1', AHORA)).get('state')!;

    await expect(servicio.completarConexion('otro', state, 'x', AHORA)).rejects.toBeInstanceOf(ConexionInvalidaError);
    // Ya se consumió en el intento anterior.
    await expect(servicio.completarConexion('user-1', state, 'x', AHORA)).rejects.toBeInstanceOf(ConexionInvalidaError);

    const viejo = paramsDe(servicio.iniciarConexion('user-1', AHORA)).get('state')!;
    await expect(servicio.completarConexion('user-1', viejo, 'x', AHORA + 11 * 60_000)).rejects.toBeInstanceOf(
      ConexionInvalidaError,
    );
    expect(mp.canjearCodigo).not.toHaveBeenCalled();
  });

  it('devuelve el token vigente sin renovarlo', async () => {
    const { servicio, mp } = crear({
      mpUserId: '777',
      accessToken: encryptToken('APP_USR-vigente', CLAVE),
      refreshToken: encryptToken('TG-r', CLAVE),
      expiraAt: new Date(AHORA + 60 * DIA),
    });
    expect(await servicio.tokenDe('user-1', AHORA)).toEqual({ accessToken: 'APP_USR-vigente', mpUserId: '777' });
    expect(mp.refrescarToken).not.toHaveBeenCalled();
  });

  it('renueva el token cuando le queda poco', async () => {
    const { servicio, mp, upsert } = crear({
      mpUserId: '777',
      accessToken: encryptToken('APP_USR-viejo', CLAVE),
      refreshToken: encryptToken('TG-r', CLAVE),
      expiraAt: new Date(AHORA + 2 * DIA),
    });
    expect((await servicio.tokenDe('user-1', AHORA))?.accessToken).toBe('APP_USR-nuevo');
    expect(mp.refrescarToken).toHaveBeenCalledWith('TG-r');
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('si la renovación falla usa el viejo mientras no haya vencido, y después devuelve null', async () => {
    const guardada = {
      mpUserId: '777',
      accessToken: encryptToken('APP_USR-viejo', CLAVE),
      refreshToken: encryptToken('TG-r', CLAVE),
      expiraAt: new Date(AHORA + 2 * DIA),
    };
    const vigente = crear(guardada);
    vigente.mp.refrescarToken.mockRejectedValue(new Error('invalid_grant'));
    expect((await vigente.servicio.tokenDe('user-1', AHORA))?.accessToken).toBe('APP_USR-viejo');

    const vencida = crear({ ...guardada, expiraAt: new Date(AHORA - 1) });
    vencida.mp.refrescarToken.mockRejectedValue(new Error('invalid_grant'));
    expect(await vencida.servicio.tokenDe('user-1', AHORA)).toBeNull();
  });

  it('sin cuenta conectada no hay token', async () => {
    expect(await crear(null).servicio.tokenDe('user-1', AHORA)).toBeNull();
  });
});
