# Trato Agenda

Bot de WhatsApp que gestiona reuniones de Google Calendar por chat.

Monorepo:

| Carpeta | Qué es |
| ------- | ------ |
| `api/` | Backend NestJS 12 + Prisma 7 + Postgres 16. Login real con Google OAuth2, sesión en cookie `httpOnly`. Ver [`api/README.md`](api/README.md). |
| `web/` | Frontend Next.js 16 (App Router) + React 19 + Tailwind v4. Onboarding: login con Google y vinculación de WhatsApp por QR. |
| `e2e/` | Tests end to end con Playwright contra el stack de docker compose, con un OpenRouter falso. Ver [Tests E2E](#tests-e2e-playwright). |
| `docker-compose.yml` | Levanta `db` (:5432), `api` (:4000) y `web` (:3000). |
| `docker-compose.e2e.yml` | Override para los E2E: suma el OpenRouter falso (:4010) y prende el login de desarrollo. |

## Arrancar

```bash
# 1. crear api/.env con las variables de la tabla de abajo
docker compose up --build
docker compose exec api npx prisma migrate dev --name init
```

### Entrar sin Google (sólo desarrollo)

Con `DEV_LOGIN_PASSWORD` en `api/.env`, `/entrar` muestra además un formulario
"Entrar con contraseña". Cada email es un usuario distinto (por defecto
`dev@trato.local`), así que sirve para probar el alta desde cero todas las veces
que haga falta. Esos usuarios no tienen Google Calendar: la API les da un
**calendario falso en memoria**, así que el chat de prueba del Home y
`/calendario` agendan, mueven y cancelan de verdad sin tocar Google (se vacía al
reiniciar la API).

Hay tres candados para que esto nunca llegue a producción: la API no registra la
ruta con `NODE_ENV=production`, el handler contesta 404 si falta la contraseña, y
`validateEnv` no arranca si `DEV_LOGIN_PASSWORD` aparece en producción. El front
tampoco incluye el formulario en el build de producción.

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
| `OPENROUTER_MODEL_AGENTES` | Opcional. Modelo sólo para **generar** agentes en `/contanos`; vacío usa `OPENROUTER_MODEL`. Generar la config es mecánico (JSON con structured outputs, sin reasoning), así que puede ir a un modelo más rápido y barato. El sufijo `:nitro` le pide a OpenRouter el proveedor con más throughput. Tiene que soportar structured outputs. |
| `OPENROUTER_BASE_URL` | Opcional. Base del endpoint OpenAI-compatible. Por defecto `https://openrouter.ai/api/v1`; los E2E la apuntan al OpenRouter falso. |
| `DEV_LOGIN_PASSWORD` | Opcional, **sólo desarrollo**. Prende el login con contraseña y el calendario falso (ver arriba). Si está definida con `NODE_ENV=production`, la API no arranca. |
| `MERCADOPAGO_ACCESS_TOKEN` | Access token de la aplicación de [Mercado Pago](https://www.mercadopago.com.ar/developers/panel) con la que se cobra la suscripción. Sin ella la API arranca igual; sólo falla el checkout. **Secreto real, nunca commitear.** |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta de las notificaciones de esa misma aplicación: con ella se verifica la firma `x-signature` de cada webhook. Sin ella, los webhooks se descartan. |
| `SUSCRIPCION_PRECIO_ARS` | Importe mensual del plan en pesos. Por defecto `20000`. |

El frontend solo necesita `NEXT_PUBLIC_API_URL`, que sale del `.env` de la raíz.

## Tests

### Unitarios

```bash
docker compose exec api npm test    # vitest, todo mockeado
```

### Tests E2E (Playwright)

`e2e/` prueba el producto de punta a punta en un browser real: login dev, el
wizard de `/contanos` en escritorio y en móvil (incluido el perfil con cinco
tipos propios que falló en producción), las validaciones, los errores del modelo
(JSON roto, proveedor caído, sesión vencida), el agente generado agendando,
moviendo y cancelando desde el chat de prueba, y el paso a `/vincular`.

Corren contra el stack de docker compose con `docker-compose.e2e.yml`, que suma
`e2e/openrouter-stub/server.mjs`: un OpenRouter falso y determinista, así que los
tests no gastan plata ni dependen de cómo redacte un modelo. El override usa su
propio nombre de proyecto (`trato-e2e`), con una base aparte que migra sola al
arrancar.

```bash
cd e2e
npm ci
npx playwright install chromium
npm run e2e:stack        # levanta db + api + web + stub (proyecto trato-e2e)
npm run e2e              # escritorio y móvil
npm run e2e:reporte      # reporte HTML, con traces de lo que falló
npm run e2e:stack:down   # baja el stack y borra su base
```

`npm run e2e:real` corre un único test (`@real`) contra **OpenRouter de verdad**:
levantá el stack normal (sin el override), con `DEV_LOGIN_PASSWORD` en
`api/.env`, y exportá `E2E_DEV_PASSWORD` con el mismo valor. Cuesta centavos.

### Eval de modelos

`api/evals/` compara modelos de OpenRouter con llamadas reales (cuesta centavos
por corrida, no corre con `npm test`):

- `generacion-agentes.eval.ts`: seis perfiles de `/contanos` (el caso de
  producción, 20 tipos, nombres raros…). Mide si genera de primera, latencia,
  tokens, costo y si el prompt nombra bot, titular, tipos y franja.
- `conversacion.eval.ts`: el grafo conversacional completo con textos difíciles
  ("el jueves a la tardecita", "movelo una hora más tarde", pedidos para el
  sábado, preguntas de precio). Los checks miran el calendario final, no la
  redacción.

```bash
docker compose exec api npm run eval                      # lista corta de evals/modelos.ts
docker compose exec -e EVAL_MODELOS=deepseek/deepseek-v4-flash,google/gemma-4-26b-a4b-it api npm run eval -- generacion
docker compose exec -e EVAL_NITRO=1 api npm run eval      # suma la variante :nitro de cada modelo
```

Imprime una tabla por modelo (casos y checks aprobados, p50/p90 de latencia,
tokens, costo) y deja el detalle en `api/evals/resultados/`. Criterio sugerido: el
más barato con ≥ 95% de checks, p90 de generación < 20s y p90 por mensaje < 8s.
Cambiar de modelo en producción es sólo tocar `OPENROUTER_MODEL` /
`OPENROUTER_MODEL_AGENTES` en Railway.

#### Corrida del 2026-09-11 (7 modelos, una pasada)

| Modelo | Generación p50/p90 | Conversación p50/p90 | Checks gen. / conv. |
| ------ | ------------------ | -------------------- | ------------------- |
| `google/gemma-4-31b-it` (actual) | 4,1s / 6,9s | 5,9s / 16,1s | 94% / 100% |
| `google/gemma-4-26b-a4b-it` | 6,0s / **60s (timeout)** | 11,4s / 44,2s | 98% / 100% |
| `deepseek/deepseek-v4-flash` | 3,1s / **56,6s** | 4,6s / 17,2s | 96% / 100% |
| `openai/gpt-oss-120b` | — | 3,6s / 6,2s | 0% / 75% |
| `qwen/qwen3.8-flash` | 5,4s / 5,7s | **2,0s / 5,2s** | 98% / 100% |
| `google/gemini-3.1-flash-lite` | **2,1s / 2,4s** | 2,0s / 3,6s | 96% / 83% |
| `inception/mercury-2.5` | 1,5s / 1,8s | 1,5s / 3,0s | 92% / 100% |

Lo que se aprendió:

- El 502 de producción no fue un modelo "malo" sino **cola de latencia del
  proveedor**: en esta misma corrida `gemma-4-26b` se colgó 60s y
  `deepseek-v4-flash` tardó 56s en un caso que normalmente resuelve en 3s. Por eso
  el timeout de generación subió a 60s y el timeout ya no se reintenta.
- `openai/gpt-oss-120b` **no sirve para generar**: su endpoint contesta
  `400 Reasoning is mandatory for this endpoint and cannot be disabled` y el
  meta-agente llama con `reasoning: { enabled: false }`.
- Los checks de generación que fallan en modelos buenos son casi siempre
  `nombraTipos` con los 20 tipos (los resumen) — no es motivo para descartarlos.
- En conversación, `gemini-3.1-flash-lite` y `gpt-oss-120b` fallaron el caso de
  reprogramar ("mejor movelo una hora más tarde"): contestaron que no había turno
  agendado en vez de usar `reprogramar_turno`.

Recomendación a partir de estos números: `OPENROUTER_MODEL=qwen/qwen3.8-flash`
(100% de checks con el p90 por mensaje más bajo de los que aciertan todo) y
`OPENROUTER_MODEL_AGENTES=google/gemini-3.1-flash-lite` (el más consistente
generando; el costo por agente es de centésimas de centavo y se paga una vez por
usuario). `inception/mercury-2.5` es más rápido y barato todavía, pero es nuevo y
fue el más flojo generando, así que conviene volver a correr el eval antes de
mandarlo a producción. Es una sola pasada por caso: repetila antes de decidir, y
si cambiás de modelo, agregá `:nitro` para que OpenRouter elija el proveedor más
rápido.

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
- **Nunca** `DEV_LOGIN_PASSWORD`: la API se niega a arrancar si la ve.

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
  con `sameSite: 'none'` + `secure` (ver `api/src/auth/cookie.ts`), y
  Safari bloquea las cookies de terceros aunque sean `SameSite=None`. Se arregla
  cuando front y API compartan dominio: subdominios de un dominio propio (y ahí la
  cookie vuelve a `lax`), o un rewrite `/api/*` en Next que proxee a la API. Perder
  `lax` también deja a la API sin la defensa de CSRF del browser, así que
  `main.ts` monta `chequeoDeOrigen` (`api/src/auth/csrf-origin.ts`): todo método
  que cambia estado con un `Origin` que no es `FRONTEND_URL` se corta con 403. Un
  pedido sin `Origin` pasa a propósito: así llega el webhook de Mercado Pago, que
  se autentica por firma y no por la cookie.

## Seguridad

`api/.env` tiene credenciales vivas de Google y las claves de firma y cifrado.
Está cubierto por `.gitignore` en la raíz y en `api/`. Antes de commitear, el
subagente `security-auditor` (en `.claude/agents/`) revisa el staging en busca de
secretos; `committer` arma los commits y aborta si detecta un `.env` en el índice.
