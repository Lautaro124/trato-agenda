import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module.js';
import { chequeoDeOrigen } from './auth/csrf-origin.js';
import { cabecerasDeSeguridad } from './security-headers.js';
import type { Env } from './config/env.js';

/** Body máximo de `POST /productos/importar` (el resto queda en el default de 100kb). */
const LIMITE_IMPORTACION = '6mb';

async function bootstrap() {
  // Los parsers se registran a mano (abajo) para que sólo la importación del
  // catálogo acepte bodies grandes.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get(ConfigService<Env, true>);

  const frontendUrl = config.get('FRONTEND_URL', { infer: true });

  // Railway pone un proxy adelante: sin esto `req.ip` es el del proxy y los
  // límites por IP del login con WhatsApp tratarían a todos como una sola IP.
  app.set('trust proxy', 1);
  // No anunciar el framework: es información gratis para quien escanea.
  app.disable('x-powered-by');
  app.use(cabecerasDeSeguridad());
  app.use(cookieParser());
  // credentials: true es obligatorio para que el navegador mande la cookie de sesión.
  app.enableCors({ origin: frontendUrl, credentials: true });
  // Y el CORS no alcanza: con la cookie en sameSite 'none' un POST sin preflight
  // desde cualquier página llegaría igual con la sesión adentro (ver csrf-origin.ts).
  app.use(chequeoDeOrigen(frontendUrl));
  // Hasta 5.000 filas de productos: no entra en los 100kb por defecto. Corre
  // antes que el parser global, que ve el body ya leído y no lo toca.
  app.use('/productos/importar', json({ limit: LIMITE_IMPORTACION }));
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
