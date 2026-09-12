import 'reflect-metadata';
import { ConflictException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentsService } from '../agents/agents.service.js';
import type { Env } from '../config/env.js';
import { AuthService } from './auth.service.js';
import { contrasenaCorrecta, DevAuthController } from './dev-auth.controller.js';

type Entorno = Partial<Record<keyof Env, string>>;

async function crearApp(entorno: Entorno, opciones: { tieneAgente?: boolean } = {}) {
  const valores: Record<string, string> = {
    NODE_ENV: 'development',
    SESSION_COOKIE_NAME: 'trato_session',
    DEV_LOGIN_PASSWORD: 'e2e-password',
    ...entorno,
  };
  const authService = {
    upsertUsuarioDev: vi.fn().mockImplementation((email: string) =>
      Promise.resolve({ id: 'user-dev', email, googleId: `dev:${email}` }),
    ),
    issueSessionToken: vi.fn().mockResolvedValue('jwt-de-prueba'),
  };
  const agentsService = {
    findByUserId: vi.fn().mockResolvedValue(opciones.tieneAgente ? { id: 'agent-1' } : null),
  };

  const modulo = await Test.createTestingModule({
    controllers: [DevAuthController],
    providers: [
      { provide: AuthService, useValue: authService },
      { provide: AgentsService, useValue: agentsService },
      { provide: ConfigService, useValue: { get: (clave: string) => valores[clave] } },
    ],
  }).compile();

  const app: INestApplication = modulo.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, authService };
}

describe('DevAuthController', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /auth/dev informa si el login dev está habilitado', async () => {
    ({ app } = await crearApp({}));
    await request(app.getHttpServer()).get('/auth/dev').expect(200, { habilitado: true });
  });

  it('sin DEV_LOGIN_PASSWORD el login responde 404 y el estado dice deshabilitado', async () => {
    ({ app } = await crearApp({ DEV_LOGIN_PASSWORD: '' }));

    await request(app.getHttpServer()).get('/auth/dev').expect(200, { habilitado: false });
    await request(app.getHttpServer()).post('/auth/dev/login').send({ password: 'lo-que-sea' }).expect(404);
  });

  it('con NODE_ENV=production responde 404 aunque la contraseña coincida', async () => {
    let authService;
    ({ app, authService } = await crearApp({ NODE_ENV: 'production' }));

    await request(app.getHttpServer()).post('/auth/dev/login').send({ password: 'e2e-password' }).expect(404);
    expect(authService.upsertUsuarioDev).not.toHaveBeenCalled();
  });

  it('una contraseña incorrecta da 401 y no crea sesión', async () => {
    let authService;
    ({ app, authService } = await crearApp({}));

    const res = await request(app.getHttpServer())
      .post('/auth/dev/login')
      .send({ password: 'otra' })
      .expect(401);

    expect(res.headers['set-cookie']).toBeUndefined();
    expect(authService.upsertUsuarioDev).not.toHaveBeenCalled();
  });

  it('la contraseña correcta deja la cookie de sesión y manda a /contanos si no hay agente', async () => {
    let authService;
    ({ app, authService } = await crearApp({}));

    const res = await request(app.getHttpServer())
      .post('/auth/dev/login')
      .send({ password: 'e2e-password', email: 'Prueba@Trato.local' })
      .expect(200, { destino: '/contanos' });

    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((cookie) => cookie.startsWith('trato_session=jwt-de-prueba') && cookie.includes('HttpOnly'))).toBe(
      true,
    );
    expect(authService.upsertUsuarioDev).toHaveBeenCalledWith('prueba@trato.local');
  });

  it('sin email usa el usuario dev por defecto y con agente manda a /inicio', async () => {
    let authService;
    ({ app, authService } = await crearApp({}, { tieneAgente: true }));

    await request(app.getHttpServer())
      .post('/auth/dev/login')
      .send({ password: 'e2e-password' })
      .expect(200, { destino: '/inicio' });
    expect(authService.upsertUsuarioDev).toHaveBeenCalledWith('dev@trato.local');
  });

  it('valida el body: sin contraseña o con email inválido da 400', async () => {
    ({ app } = await crearApp({}));

    await request(app.getHttpServer()).post('/auth/dev/login').send({}).expect(400);
    await request(app.getHttpServer())
      .post('/auth/dev/login')
      .send({ password: 'e2e-password', email: 'no-es-email' })
      .expect(400);
  });

  it('propaga el 409 si el email ya es de un usuario de Google', async () => {
    let authService;
    ({ app, authService } = await crearApp({}));
    authService.upsertUsuarioDev.mockRejectedValue(new ConflictException('Ese email ya es de un usuario de Google.'));

    await request(app.getHttpServer())
      .post('/auth/dev/login')
      .send({ password: 'e2e-password', email: 'real@gmail.com' })
      .expect(409);
  });
});

describe('contrasenaCorrecta', () => {
  it('compara sin importar el largo de cada lado', () => {
    expect(contrasenaCorrecta('e2e-password', 'e2e-password')).toBe(true);
    expect(contrasenaCorrecta('e2e', 'e2e-password')).toBe(false);
    expect(contrasenaCorrecta('', 'e2e-password')).toBe(false);
  });
});
