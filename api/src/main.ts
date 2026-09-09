import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { chequeoDeOrigen } from './auth/csrf-origin.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  const frontendUrl = config.get('FRONTEND_URL', { infer: true });

  app.use(cookieParser());
  // credentials: true es obligatorio para que el navegador mande la cookie de sesión.
  app.enableCors({ origin: frontendUrl, credentials: true });
  // Y el CORS no alcanza: con la cookie en sameSite 'none' un POST sin preflight
  // desde cualquier página llegaría igual con la sesión adentro (ver csrf-origin.ts).
  app.use(chequeoDeOrigen(frontendUrl));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
