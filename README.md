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

Van en `api/.env`, que **no está versionado** y nunca debe subirse. Si falta
alguna, la API no arranca: la validación está en `api/src/config/env.ts`.

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

El frontend solo necesita `NEXT_PUBLIC_API_URL`, que `docker-compose.yml` ya
define como `http://localhost:4000`.

## Seguridad

`api/.env` tiene credenciales vivas de Google y las claves de firma y cifrado.
Está cubierto por `.gitignore` en la raíz y en `api/`. Antes de commitear, el
subagente `security-auditor` (en `.claude/agents/`) revisa el staging en busca de
secretos; `committer` arma los commits y aborta si detecta un `.env` en el índice.
