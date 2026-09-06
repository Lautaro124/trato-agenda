# Deploy en Railway

Guía para levantar Trato Agenda en [Railway](https://railway.com): tres servicios
(`Postgres`, `api`, `web`) construidos desde los `Dockerfile` del repo.

No hace falta ningún volumen: la sesión de WhatsApp (Baileys) se guarda cifrada en
Postgres (`WhatsappSession.authState`) y los checkpoints de LangGraph también, así que el
contenedor es descartable y se reconecta solo al reiniciar.

---

## 1. Crear el proyecto y la base

1. En Railway: **New Project** → **Deploy from GitHub repo** → elegí este repo.
2. Dentro del proyecto: **+ New** → **Database** → **Add PostgreSQL**.

## 2. Crear los dos servicios

Cada carpeta del monorepo es un servicio distinto. Para cada uno, **+ New** → **GitHub
Repo** → este repo, y después en **Settings**:

| Servicio | Root Directory | Builder |
| -------- | -------------- | ------- |
| `api` | `api` | Dockerfile (se detecta solo) |
| `web` | `web` | Dockerfile (se detecta solo) |

El `railway.json` de cada carpeta ya fija el healthcheck y la política de reinicio. En
`api` fija además `numReplicas: 1`, y **eso no es opcional**: el socket de Baileys es
estado en memoria del proceso, dos réplicas se pelearían por la misma sesión de WhatsApp.

En ambos servicios, **Settings → Networking → Generate Domain**. Anotá los dos dominios:
los vas a necesitar en las variables.

> **Importante: `api` primero.** `NEXT_PUBLIC_API_URL` se inlinea en el bundle de Next
> **en tiempo de build** (es un `ARG` del `web/Dockerfile`), así que el dominio de la API
> tiene que existir antes de que `web` se construya. Si `web` buildeó antes, va a quedar
> apuntando a `http://localhost:4000` y hay que redeployarlo.

## 3. Variables del servicio `api`

Railway resuelve solo las referencias `${{...}}` — pegalas tal cual.

| Variable | Valor |
| -------- | ----- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` |
| `GOOGLE_CALLBACK_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}/auth/google/callback` |
| `COOKIE_SAMESITE` | `none` |
| `COOKIE_SECURE` | `true` |
| `GOOGLE_CLIENT_ID` | de Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | de Google Cloud Console |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` (32 bytes exactos) |
| `OPENROUTER_API_KEY` | tu clave de OpenRouter |
| `OPENROUTER_MODEL` | ej. `openai/gpt-4o-mini` |

`JWT_EXPIRES_IN` y `SESSION_COOKIE_NAME` quedan en su default. **No definas `PORT`**:
Railway lo inyecta y tanto `main.ts` como el `server.js` de Next lo respetan.

Generá `JWT_SECRET` y `TOKEN_ENCRYPTION_KEY` **nuevos**, distintos a los de tu `.env`
local: son entornos separados y no comparten base.

> ⚠️ `TOKEN_ENCRYPTION_KEY` cifra el refresh token de Google **y** la sesión de Baileys
> guardadas en la base. Si la cambiás después del primer login, todo lo que ya estaba
> guardado queda ilegible: hay que volver a entrar con Google y a escanear el QR.

## 4. Variables del servicio `web`

| Variable | Valor |
| -------- | ----- |
| `NEXT_PUBLIC_API_URL` | `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` |

Es build-time: **cada vez que la cambies hay que redeployar `web`**, reiniciar no alcanza.

## 5. Google Cloud Console

En el OAuth Client (tipo *Web application*) que ya usás en local, **agregá** (no
reemplaces, así te sigue andando localhost):

- *Authorized redirect URIs*: `https://<dominio-de-api>/auth/google/callback`
- *Authorized JavaScript origins*: `https://<dominio-de-web>`

Si la app está en modo **Testing**, tu mail tiene que estar en la lista de *Test users*.

## 6. Apagar el sleeping de `api`

**Settings → deshabilitar Serverless / App Sleeping** en el servicio `api`. Si el
contenedor se duerme se cae el socket de WhatsApp y el agente deja de contestar mensajes
hasta que alguien vuelva a entrar a la web. `web` sí puede dormir sin problema.

## 7. Deployar y verificar

Las migraciones corren solas: el `CMD` de la imagen de producción es
`npx prisma migrate deploy && node dist/main`.

1. `curl https://<dominio-de-api>/health` → `{"status":"ok"}`.
2. En los logs de `api` tienen que aparecer las migraciones aplicadas y
   *"Tablas del checkpointer de LangGraph listas."*.
3. Abrí `https://<dominio-de-web>` **en Chrome** → te lleva a `/entrar` → login con Google
   → caés en `/contanos`.
4. DevTools → Application → Cookies: `trato_session` tiene que estar con `SameSite=None`
   y `Secure`. Recargá `/contanos`: si no te patea a `/entrar`, la cookie está viajando
   bien en las llamadas XHR.
5. Completá el wizard → `/vincular` → aparece el QR (eso prueba que el SSE con
   credenciales pasa) → escanealo → la tarjeta pasa a "connected".
6. Mandale un mensaje al número vinculado desde otro teléfono: el agente contesta y, al
   agendar, el evento aparece en tu Google Calendar.
7. Reiniciá `api` desde el dashboard: la sesión de WhatsApp se resume sola, sin pedir QR.

---

## La cookie de sesión y el límite de esta topología

Con `api` y `web` en dos subdominios de `*.up.railway.app`, el navegador los considera
**sites distintos** (`up.railway.app` está en la Public Suffix List). Por eso la cookie va
con `SameSite=None; Secure`: con `lax` el navegador no la manda en las llamadas de
`apiFetch` ni en el `EventSource` del QR, y `GET /auth/me` responde 401 para siempre.

`SameSite=None` es, por definición, una **cookie de terceros**:

- ✅ Chrome y Firefox con la configuración por defecto: anda.
- ❌ **Safari (ITP)** y cualquier navegador con cookies de terceros bloqueadas: la sesión
  no persiste y el login no completa.

**El arreglo definitivo es un dominio propio**: `app.tudominio.com` para `web` y
`api.tudominio.com` para `api`. Al compartir el mismo dominio registrable pasan a ser el
mismo *site*, y entonces alcanza con volver a poner `COOKIE_SAMESITE=lax` (o borrar las
dos variables, que es el default) — sin tocar una línea de código. En Railway se agregan
en **Settings → Networking → Custom Domain**, y hay que actualizar `FRONTEND_URL`,
`GOOGLE_CALLBACK_URL`, `NEXT_PUBLIC_API_URL` y las URIs en Google Cloud Console.

---

## Troubleshooting

| Síntoma | Causa probable |
| ------- | -------------- |
| `GET /auth/me` da 401 y volvés siempre a `/entrar` | La cookie de terceros está bloqueada. Probá en Chrome sin bloqueo, o pasá a dominio propio + `COOKIE_SAMESITE=lax`. |
| `redirect_uri_mismatch` de Google | Falta la redirect URI exacta (con `https://` y sin barra final) en Google Cloud Console. |
| El front pega a `http://localhost:4000` | `web` se buildeó sin `NEXT_PUBLIC_API_URL`. Definila y **redeployá** `web`. |
| El QR nunca aparece en `/vincular` | El SSE no llega: revisá que `FRONTEND_URL` sea exactamente el origen del front (el CORS lo compara literal). |
| La API no arranca: *"Faltan variables de entorno"* | Falta alguna de la tabla del paso 3. El error las nombra. |
| La API no arranca: *"COOKIE_SAMESITE=none exige COOKIE_SECURE=true"* | Pusiste `none` sin `COOKIE_SECURE=true`. |
| El agente dejó de contestar mensajes de WhatsApp | El servicio `api` se durmió. Apagá el sleeping (paso 6). |
| El build de `api` falla en `npm ci` | Sólo pasa con npm ≤ 10 (el lockfile se generó con npm ≥ 11). La imagen usa `node:24-alpine`, que trae npm 11: en Railway no ocurre. |
