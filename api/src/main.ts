import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Env, true>);

  // Railway (y cualquier PaaS) termina TLS en su borde y habla HTTP con el
  // contenedor: sin esto Express ve req.protocol === 'http' y arma mal las URLs
  // absolutas del flujo de OAuth.
  app.set('trust proxy', 1);

  app.use(cookieParser());
  // credentials: true es obligatorio para que el navegador mande la cookie de sesión.
  app.enableCors({ origin: config.get('FRONTEND_URL', { infer: true }), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
