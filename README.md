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

La imagen de producción de la API (`api/Dockerfile`, etapa `prod`) corre
`prisma migrate deploy` antes de arrancar, así que una base vacía se migra sola
en el primer deploy — por eso el CLI de Prisma está en `dependencies` y no en
`devDependencies`, que `npm prune --omit=dev` se lo llevaría.

En [Railway](https://docs.railway.com/), un servicio por carpeta (`api/` y
`web/`) más el plugin de Postgres. Tres cosas que no son obvias:

- **`DATABASE_URL`** no se escribe a mano: en el servicio de la API se
  referencia la del plugin, `${{ Postgres.DATABASE_URL }}`. Nada del
  `docker-compose.yml` interviene en el deploy; ahí sólo importa que la API lea
  esa variable del entorno, que es lo que hace.
- **`NEXT_PUBLIC_API_URL` se resuelve en build, no en runtime.** Railway aísla
  el build del entorno salvo que la variable esté declarada con `ARG` en la
  etapa que la usa; `web/Dockerfile` ya la declara en la etapa `build`, así que
  alcanza con definirla en el servicio, apuntándola al dominio de la API
  (`https://${{ api.RAILWAY_PUBLIC_DOMAIN }}`). Si se olvida, el bundle queda
  hablándole a `http://localhost:4000` y el síntoma es un front que carga pero
  no autentica nunca.
- **`GOOGLE_CALLBACK_URL` y `FRONTEND_URL`** pasan a los dominios reales, y la
  callback hay que autorizarla también en la consola de Google. Con dominios
  distintos para front y API, la cookie de sesión necesita `sameSite: 'none'` +
  `secure` (hoy es `lax`, ver `api/src/auth/auth.controller.ts`).

La URL del webhook de Mercado Pago (`POST /suscripcion/webhook`) se carga en el
panel de la aplicación apuntando al dominio público de la API.

## Seguridad

`api/.env` tiene credenciales vivas de Google y las claves de firma y cifrado.
Está cubierto por `.gitignore` en la raíz y en `api/`. Antes de commitear, el
subagente `security-auditor` (en `.claude/agents/`) revisa el staging en busca de
secretos; `committer` arma los commits y aborta si detecta un `.env` en el índice.
