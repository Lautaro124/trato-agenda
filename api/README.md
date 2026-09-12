# Trato Agenda — API

Backend NestJS con login real de Google (OAuth2). Guarda al usuario en Postgres y
deja la sesión en una cookie `httpOnly` con un JWT propio.

Corre todo en Docker: `api` (Nest en modo watch) + `db` (Postgres 16).

## 1. Credenciales de Google

En [Google Cloud Console](https://console.cloud.google.com/):

1. Crear un proyecto.
2. Habilitar la **Google Calendar API**.
3. Pantalla de consentimiento OAuth: tipo *External*. En desarrollo alcanza el
   modo *Testing* con tu mail como *test user* (si no, Google rechaza el login);
   producción necesita la app verificada — ver
   [`docs/verificacion-google.md`](../docs/verificacion-google.md).
4. *Credentials* → *Create credentials* → *OAuth client ID* → **Web application**.
   - Authorized redirect URI: `http://localhost:4000/auth/google/callback`

Los scopes que pide la app son los de `GOOGLE_SCOPES`
(`src/auth/google.strategy.ts`): `openid`, `profile`, `email`,
`calendar.events` y `calendar.freebusy`. Son el mínimo que se usa de verdad y
están justificados uno por uno en el documento de verificación: ampliarlos obliga
a todos los usuarios a consentir de nuevo.

## 2. Variables de entorno

Crear `api/.env` a mano. La lista completa de variables, con qué significa cada
una, está en el [README de la raíz](../README.md#variables-de-entorno). El archivo
no se versiona y no debe subirse nunca.

```bash
openssl rand -hex 32   # para JWT_SECRET
openssl rand -hex 32   # para TOKEN_ENCRYPTION_KEY (32 bytes exactos)
```

Completar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` con lo del paso 1. Si falta
alguna variable la API no arranca: la validación está en `src/config/env.ts`.

## 3. Levantar

Desde la **raíz del repo** (no desde `api/`):

```bash
docker compose up --build          # api en :4000, postgres en :5432
docker compose exec api npx prisma migrate dev --name init
```

Otros comandos, siempre dentro del contenedor:

```bash
docker compose exec api npm run lint
docker compose exec api npm test
docker compose exec api npx prisma studio     # inspeccionar la base
docker compose logs -f api
```

Si cambiás algo en `api/.env`, **`docker compose restart api` no alcanza**: el
`env_file` se resuelve cuando se crea el contenedor, así que un restart reinicia el
proceso con el entorno viejo. Con credenciales viejas Google contesta
`Error 401: invalid_client`. Hay que recrearlo:

```bash
docker compose up -d --force-recreate api
```

Después de instalar una dependencia nueva hay que recrear el contenedor, porque
`node_modules` vive en un volumen anónimo:

```bash
docker compose build api && docker compose rm -sfv api && docker compose up -d api
```

## 4. Probar el login

1. Abrir `http://localhost:4000/auth/google`.
2. Consentir en Google (pide perfil, email y **Calendar**).
3. Vuelve al callback y redirige a `FRONTEND_URL/vincular`, dejando la cookie
   `trato_session`.
4. `GET http://localhost:4000/auth/me` devuelve el usuario mientras la cookie viva.

## Endpoints

| Método | Ruta                   | Qué hace                                             |
| ------ | ---------------------- | ---------------------------------------------------- |
| GET    | `/health`              | Ping para el healthcheck.                            |
| GET    | `/auth/google`         | Redirige al consentimiento de Google.                |
| GET    | `/auth/google/callback`| Crea/actualiza el usuario, setea la cookie, va a `/vincular`.|
| GET    | `/auth/me`             | Usuario de la sesión. 401 sin cookie válida.         |
| POST   | `/auth/logout`         | Borra la cookie (204).                               |

## Detalles que importan

- **Refresh token cifrado.** Google sólo lo manda con `access_type=offline` +
  `prompt=consent` (ver `src/auth/guards/google-auth.guard.ts`), y se guarda
  cifrado con AES-256-GCM (`src/auth/token-crypto.ts`). Nunca sale por la API.
  Si en un login Google no lo manda, se conserva el que ya estaba.
- **La sesión va en cookie, no en `Authorization`.** Por eso `JwtStrategy` usa un
  `jwtFromRequest` propio que lee `req.cookies`, y `main.ts` habilita CORS con
  `credentials: true`.
- **Prisma 7.** La URL de conexión va en `prisma.config.ts`, no en el schema, y el
  cliente se genera en `src/generated/prisma` (ignorado por git).
- **Watch con polling.** El bind mount sobre `/mnt/c` en WSL2 no propaga eventos
  inotify: `tsconfig.json` fuerza polling para que el hot reload funcione.

## Todavía falta

El login ya está conectado punta a punta: `web/` pide el usuario a `/auth/me` con
la cookie (`web/src/lib/session.tsx`) y el callback vuelve a `FRONTEND_URL/vincular`.

Google Calendar, la vinculación de WhatsApp y la conversación son reales: el
refresh token se guarda cifrado y `googleapis` refresca el access token en cada
llamada (`src/calendar/google-calendar.client.ts`), `/vincular` hace un pairing
real por Baileys (`src/whatsapp/`) y el asistente contesta con el grafo de
`src/conversation/`. La cookie de sesión va `sameSite: 'lax'` cuando front y API
comparten sitio y cae a `'none'` + `secure` cuando no (`src/auth/cookie.ts`).
