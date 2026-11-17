import 'reflect-metadata';
import { UnauthorizedException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentsService } from '../agents/agents.service.js';
import { MetaWhatsappService } from '../whatsapp/meta/meta-whatsapp.service.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';
import { AltaMetaService } from './alta-meta.service.js';
import { AltaWhatsappService } from './alta-whatsapp.service.js';
import { AuthService } from './auth.service.js';
import { CodigoAccesoService } from './codigo-acceso.service.js';
import { LoginWhatsappService } from './login-whatsapp.service.js';
import { WhatsappAuthController } from './whatsapp-auth.controller.js';

const USUARIO = { id: 'user-1', googleId: null, phoneNumber: '5491122334455', passwordHash: 'scrypt$x' };

async function crearApp({ metaConfigurado = true } = {}) {
  const altasMeta = { entrar: vi.fn().mockResolvedValue({ ...USUARIO, passwordHash: null }) };
  const logins = {
    entrar: vi.fn().mockResolvedValue(USUARIO),
    guardar: vi.fn().mockResolvedValue(USUARIO),
  };
  const codigos = { verificar: vi.fn().mockResolvedValue({ ...USUARIO, passwordHash: null }), solicitar: vi.fn() };
  const valores: Record<string, string> = {
    NODE_ENV: 'development',
    SESSION_COOKIE_NAME: 'trato_session',
    META_APP_ID: 'app-1',
    META_ES_CONFIG_ID: 'config-1',
    META_APP_SECRET: 'no-se-expone',
  };

  const modulo = await Test.createTestingModule({
    controllers: [WhatsappAuthController],
    providers: [
      { provide: AuthService, useValue: { issueSessionToken: vi.fn().mockResolvedValue('jwt') } },
      { provide: AltaWhatsappService, useValue: {} },
      { provide: CodigoAccesoService, useValue: codigos },
      { provide: LoginWhatsappService, useValue: logins },
      { provide: WhatsappService, useValue: {} },
      { provide: AgentsService, useValue: { findByUserId: vi.fn().mockResolvedValue({ id: 'agent-1' }) } },
      { provide: ConfigService, useValue: { get: (clave: string) => valores[clave] } },
      { provide: AltaMetaService, useValue: altasMeta },
      { provide: MetaWhatsappService, useValue: { configurado: metaConfigurado } },
    ],
  }).compile();

  const app: INestApplication = modulo.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, logins, codigos, altasMeta };
}

const SIGNUP = { code: 'AQB-codigo_de.meta', wabaId: '1029384756', phoneNumberId: '5647382910', coexistencia: true };

describe('WhatsappAuthController', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('POST /auth/whatsapp/login normaliza el número, deja la sesión y devuelve el destino', async () => {
    let logins;
    ({ app, logins } = await crearApp());

    const res = await request(app.getHttpServer())
      .post('/auth/whatsapp/login')
      .send({ telefono: '+54 9 11 2233-4455', password: 'clave-correcta' })
      .expect(200, { destino: '/inicio' });

    expect(logins.entrar).toHaveBeenCalledWith('5491122334455', 'clave-correcta', expect.any(String));
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).some((c) => c.startsWith('trato_session=jwt'))).toBe(
      true,
    );
  });

  it('GET /auth/whatsapp/meta/config da sólo los ids públicos de la app de Meta', async () => {
    ({ app } = await crearApp());
    const res = await request(app.getHttpServer()).get('/auth/whatsapp/meta/config').expect(200);
    expect(res.body).toEqual({ appId: 'app-1', configId: 'config-1' });
    expect(JSON.stringify(res.body)).not.toContain('no-se-expone');
  });

  it('sin Meta configurado, /meta/config no ofrece la conexión oficial', async () => {
    ({ app } = await crearApp({ metaConfigurado: false }));
    const res = await request(app.getHttpServer()).get('/auth/whatsapp/meta/config').expect(200);
    expect(res.body).toEqual({ appId: null, configId: null });
  });

  it('POST /auth/whatsapp/meta crea o entra a la cuenta y deja la sesión', async () => {
    let altasMeta;
    ({ app, altasMeta } = await crearApp());
    const res = await request(app.getHttpServer()).post('/auth/whatsapp/meta').send(SIGNUP).expect(200);
    expect(altasMeta.entrar).toHaveBeenCalledWith(expect.any(String), SIGNUP);
    expect(res.body).toEqual({ destino: expect.any(String) });
    expect(([] as string[]).concat(res.headers['set-cookie'] ?? []).some((c) => c.startsWith('trato_session=jwt'))).toBe(true);
  });

  it('POST /auth/whatsapp/meta rechaza ids que no son de Meta sin llamar al servicio', async () => {
    let altasMeta;
    ({ app, altasMeta } = await crearApp());
    await request(app.getHttpServer())
      .post('/auth/whatsapp/meta')
      .send({ ...SIGNUP, wabaId: '../../me' })
      .expect(400);
    expect(altasMeta.entrar).not.toHaveBeenCalled();
  });

  it('un login rechazado no deja cookie', async () => {
    let logins;
    ({ app, logins } = await crearApp());
    logins.entrar.mockRejectedValue(new UnauthorizedException('El número o la contraseña no son correctos.'));

    const res = await request(app.getHttpServer())
      .post('/auth/whatsapp/login')
      .send({ telefono: '5491122334455', password: 'mala' })
      .expect(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('recuperar exige una contraseña nueva de al menos 8 caracteres y la guarda', async () => {
    let logins;
    ({ app, logins } = await crearApp());
    const servidor = app.getHttpServer();

    await request(servidor)
      .post('/auth/whatsapp/codigo/verificar')
      .send({ telefono: '5491122334455', codigo: '123456' })
      .expect(400);
    await request(servidor)
      .post('/auth/whatsapp/codigo/verificar')
      .send({ telefono: '5491122334455', codigo: '123456', nuevaPassword: 'corta' })
      .expect(400);

    await request(servidor)
      .post('/auth/whatsapp/codigo/verificar')
      .send({ telefono: '5491122334455', codigo: '123456', nuevaPassword: 'una-nueva-clave' })
      .expect(200, { destino: '/inicio' });
    expect(logins.guardar).toHaveBeenCalledWith('user-1', 'una-nueva-clave');
  });
});
