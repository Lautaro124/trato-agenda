# Trato Agenda

Bot de WhatsApp que gestiona reuniones de Google Calendar por chat.

Monorepo:

| Carpeta | Qué es |
| ------- | ------ |
| `api/` | Backend NestJS 12 + Prisma 7 + Postgres 16. Login real con Google OAuth2, sesión en cookie `httpOnly`. Ver [`api/README.md`](api/README.md). |
| `web/` | Frontend Next.js 16 (App Router) + React 19 + Tailwind v4. Onboarding: login con Google y vinculación de WhatsApp por QR. |
| `docker-compose.yml` | Levanta `db` (:5432), `api` (:4000) y `web` (:3000). |

## Arrancar

```bash
# 1. crear api/.env con las variables de la tabla de abajo
docker compose up --build
docker compose exec api npx prisma migrate dev --name init
```

## Variables de entorno

Hay dos archivos, ninguno versionado:

- **`.env` en la raíz** — lo lee `docker-compose.yml` para levantar el stack
  local. Todas sus variables tienen un default en el compose, así que
  `docker compose up` funciona sin crearlo. La plantilla es
  [`.env.example`](.env.example).
- **`api/.env`** — los secretos de la API. Si falta alguna de las obligatorias,
  la API no arranca: la validación está en `api/src/config/env.ts`.

### Raíz (`.env`, opcional)

| Variable | Descripción |
| -------- | ----------- |
| `POSTGRES_USER` | Usuario de Postgres. Por defecto `postgres`. |
| `POSTGRES_PASSWORD` | Su contraseña. Por defecto `postgres`. Si tiene `@ : / ?`, escribila percent-encoded: termina adentro de la `DATABASE_URL`. |
| `POSTGRES_DB` | Nombre de la base. Por defecto `trato`. |
| `NEXT_PUBLIC_API_URL` | Origen desde el que **el browser** ve la API. Por defecto `http://localhost:4000`. Se inlinea en el bundle durante el build, no es una variable de runtime. |

Las tres primeras arman a la vez las credenciales del servicio `db` y la
`DATABASE_URL` que recibe la API, así que no pueden desincronizarse.

### API (`api/.env`)

| Variable | Descripción |
| -------- | ----------- |
| `DATABASE_URL` | Conexión a Postgres. Dentro de compose el host es el servicio `db`, no `localhost`: `postgresql://postgres:postgres@db:5432/trato`. |
| `GOOGLE_CLIENT_ID` | OAuth Client ID tipo *Web application* de Google Cloud Console. |
| `GOOGLE_CLIENT_SECRET` | Secreto de ese mismo client. **Secreto real, nunca commitear.** |
| `GOOGLE_CALLBACK_URL` | Redirect URI autorizada en la consola de Google. En local: `http://localhost:4000/auth/google/callback`. |
| `JWT_SECRET` | Firma del JWT de sesión. Generar con `openssl rand -hex 32`. |
| `JWT_EXPIRES_IN` | Vida del JWT de sesión. Por defecto `7d`. |
| `TOKEN_ENCRYPTION_KEY` | Clave AES-256-GCM que cifra el refresh token de Google en la base. **32 bytes exactos**: `openssl rand -hex 32`. |
| `FRONTEND_URL` | Origen del frontend, usado para el CORS y para el redirect post-login. En local: `http://localhost:3000`. |
| `SESSION_COOKIE_NAME` | Nombre de la cookie de sesión. Por defecto `trato_session`. |
| `PORT` | Puerto de la API. Por defecto `4000`. |
| `NODE_ENV` | `development` o `production`. |
| `OPENROUTER_API_KEY` | Clave de [OpenRouter](https://openrouter.ai/), usada para generar la config del agente y para la conversación por WhatsApp. Sin ella la API arranca igual, pero esas dos funciones fallan con un error claro. |
| `OPENROUTER_MODEL` | Modelo de OpenRouter a usar (formato `proveedor/modelo`). Por defecto `google/gemma-4-31b-it`. Tiene que soportar tool calling **y** reasoning: el runtime conversacional lo llama con `reasoning: { effort: 'low' }` ([lista filtrada](https://openrouter.ai/models?supported_parameters=tools,reasoning)). |
| `MERCADOPAGO_ACCESS_TOKEN` | Access token de la aplicación de [Mercado Pago](https://www.mercadopago.com.ar/developers/panel) con la que se cobra la suscripción. Sin ella la API arranca igual; sólo falla el checkout. **Secreto real, nunca commitear.** |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta de las notificaciones de esa misma aplicación: con ella se verifica la firma `x-signature` de cada webhook. Sin ella, los webhooks se descartan. |
| `SUSCRIPCION_PRECIO_ARS` | Importe mensual del plan en pesos. Por defecto `20000`. |

El frontend solo necesita `NEXT_PUBLIC_API_URL`, que sale del `.env` de la raíz.

## Deploy

Producción vive en [Railway](https://docs.railway.com/), proyecto **trato-agenda**,
environment `production`: el plugin de Postgres más un servicio por carpeta, cada
uno con su `rootDirectory` (`/api`, `/web`) y su Dockerfile. Las dos imágenes
terminan en la etapa `prod`, así que Railway buildea la correcta sin `--target`.

| Servicio | Dominio |
| -------- | ------- |
| `web` | https://web-production-8d1ba.up.railway.app |
| `api` | https://api-production-a4a0.up.railway.app |

**El deploy es automático**: los dos servicios están conectados al repo de GitHub
en la rama `main`, así que cada push buildea y despliega. Los *watch paths*
(`api/**` y `web/**`) hacen que un cambio en el front no rebuildee la API y
viceversa. La imagen de la API corre `prisma migrate deploy` al arrancar, así que
las migraciones también viajan solas (el healthcheck es `/health`, con 300s de
timeout para que la migración entre).

### Variables en Railway

En el servicio `api`, además de las de la tabla de arriba:

- `DATABASE_URL` es una **referencia**, `${{Postgres.DATABASE_URL}}`, no un
  literal: si Railway rota las credenciales de la base, la API las sigue.
- `FRONTEND_URL` y `GOOGLE_CALLBACK_URL` apuntan a los dominios de arriba.
  `FRONTEND_URL` va sin barra final: es el `origin` exacto del CORS.
- `JWT_SECRET` y `TOKEN_ENCRYPTION_KEY` son **propias de producción**, generadas
  con `openssl rand -hex 32`. No se reusan las locales: `TOKEN_ENCRYPTION_KEY`
  cifra los refresh tokens de Google, y una vez elegida no se rota sin invalidar
  todas las cuentas ya vinculadas.
- `TZ=America/Argentina/Buenos_Aires`.

En el servicio `web`, `NEXT_PUBLIC_API_URL` apunta al dominio de la API. Se
resuelve **en el build** (Railway la pasa como build arg porque `web/Dockerfile`
la declara con `ARG` en la etapa `build`): cambiarla exige rebuildear, no alcanza
con reiniciar.

### Tres cosas que hay que hacer a mano

1. **Consola de Google**: autorizar
   `https://api-production-a4a0.up.railway.app/auth/google/callback` como *redirect
   URI* y el dominio del front como *JavaScript origin*.
2. **Mercado Pago**: apuntar el webhook de la aplicación a
   `https://api-production-a4a0.up.railway.app/suscripcion/webhook`.
3. **Railway GitHub App**: darle acceso al repo si todavía no lo tiene.

### Dos límites que conviene tener presentes

- **La API no escala a más de una réplica.** `WhatsappService.onModuleInit` resume
  todas las sesiones vinculadas al arrancar; con dos réplicas habría dos sockets
  de Baileys peleándose la misma sesión. Por lo mismo, `sleepApplication` está en
  `false`: el socket tiene que seguir vivo entre mensajes.
- **El login no funciona en Safari/iOS.** Con front y API en subdominios distintos
  de `up.railway.app` la cookie de sesión es cross-site, así que en producción va
  con `sameSite: 'none'` + `secure` (ver `api/src/auth/auth.controller.ts`), y
  Safari bloquea las cookies de terceros aunque sean `SameSite=None`. Se arregla
  cuando front y API compartan dominio: subdominios de un dominio propio (y ahí la
  cookie vuelve a `lax`), o un rewrite `/api/*` en Next que proxee a la API.

## Seguridad

`api/.env` tiene credenciales vivas de Google y las claves de firma y cifrado.
Está cubierto por `.gitignore` en la raíz y en `api/`. Antes de commitear, el
subagente `security-auditor` (en `.claude/agents/`) revisa el staging en busca de
secretos; `committer` arma los commits y aborta si detecta un `.env` en el índice.
