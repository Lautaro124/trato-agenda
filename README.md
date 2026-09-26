# Trato Agenda

Bot de WhatsApp que gestiona turnos por chat, sobre una agenda propia o sobre
Google Calendar. La cuenta se crea con Google o sólo escaneando el QR de WhatsApp.

Un comercio puede elegir, en cambio, un **asistente de ventas**: busca en su
catálogo (búsqueda híbrida de texto + embeddings en pgvector), informa precio y
stock, arma el pedido reservando el stock, manda un link de pago de Mercado Pago
a nombre del comercio (con OAuth) o deja el cobro a coordinar, avisa al dueño en
el panel y por WhatsApp, y guarda el histórico de ventas con gráficos y CSV.

Monorepo:

| Carpeta | Qué es |
| ------- | ------ |
| `api/` | Backend NestJS 12 + Prisma 7 + Postgres 16 con pgvector. Login real con Google OAuth2 o sólo con WhatsApp (QR + contraseña para el alta, número + contraseña para volver, código al chat propio para recuperarla), sesión en cookie `httpOnly`. Ver [`api/README.md`](api/README.md). |
| `web/` | Frontend Next.js 16 (App Router) + React 19 + Tailwind v4. Onboarding: alta con WhatsApp o con Google, y vinculación de WhatsApp por QR. |
| `e2e/` | Tests end to end con Playwright contra el stack de docker compose, con un OpenRouter y un Mercado Pago falsos. Ver [Tests E2E](#tests-e2e-playwright). |
| `docker-compose.yml` | Levanta `db` (:5432), `api` (:4000) y `web` (:3000). |
| `docker-compose.e2e.yml` | Override para los E2E: suma el OpenRouter falso (:4010) y el Mercado Pago falso (:4020), y prende el login de desarrollo. |

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
que haga falta. Con un teléfono en vez de email, el usuario imita una cuenta
creada sólo con WhatsApp (sin socket de verdad: entra primero a elegir su
contraseña, y el código para recuperarla se lee de
`GET /auth/dev/ultimo-codigo?telefono=`). Esos usuarios no tienen Google
Calendar: usan la **agenda local** en Postgres, la misma de las cuentas de
WhatsApp, así que el chat de prueba del Home y `/calendario` agendan, mueven y
cancelan de verdad sin tocar Google.

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
| `OPENROUTER_API_KEY` | Clave de [OpenRouter](https://openrouter.ai/), usada para la conversación por WhatsApp y el resumen de cliente. La generación de la config del agente en `/contanos` no la necesita: usa una plantilla determinista (`api/src/agents/agent-template.ts`), sin llamadas al modelo. Sin esta clave la API arranca igual, pero la conversación falla con un error claro. |
| `OPENROUTER_MODEL` | Modelo de OpenRouter a usar (formato `proveedor/modelo`). Por defecto `google/gemma-4-31b-it`. Tiene que soportar tool calling **y** reasoning: el runtime conversacional lo llama con `reasoning: { effort: 'low' }` ([lista filtrada](https://openrouter.ai/models?supported_parameters=tools,reasoning)). |
| `OPENROUTER_BASE_URL` | Opcional. Base del endpoint OpenAI-compatible. Por defecto `https://openrouter.ai/api/v1`; los E2E la apuntan al OpenRouter falso. |
| `OPENROUTER_EMBEDDINGS_MODEL` | Opcional. Modelo de embeddings del catálogo del asistente de ventas. Por defecto `openai/text-embedding-3-small`, que tiene endpoint ZDR (Azure). Tiene que dar vectores de **1536** dimensiones (la columna `Producto.embedding`): otro tamaño es una migración, y otro modelo obliga a recalibrar `DISTANCIA_MAXIMA` en `busqueda.service.ts`. |

Sobre el modelo: **toda** llamada a OpenRouter viaja con
`provider: { data_collection: 'deny', zdr: true }` (`POLITICA_DE_PROVEEDOR` en
`api/src/agents/openrouter.client.ts`, importada también por
`api/src/conversation/llm.provider.ts`). Eso restringe el ruteo a proveedores que
no guardan los prompts ni entrenan con ellos, es lo que la app declara en
`/privacidad` y es un requisito de Limited Use de Google — no sacarlo. Como
también restringe el conjunto de proveedores elegibles, un modelo sin endpoint
ZDR deja de estar disponible: correr `npm run eval` antes de cambiar
`OPENROUTER_MODEL`. La corrida del 12/09/2026 confirmó que ningún modelo de la
lista perdió el ruteo, pero que `google/gemma-4-31b-it` quedó el doble de lento
bajo ZDR (p50 de 5.9s a 12.1s, con casos que pasan el timeout de 40s del
runtime). Los números y las alternativas están en
[`docs/modelo-y-zdr.md`](docs/modelo-y-zdr.md); la decisión de qué modelo usar
está pendiente.
| `DEV_LOGIN_PASSWORD` | Opcional, **sólo desarrollo**. Prende el login con contraseña y el calendario falso (ver arriba). Si está definida con `NODE_ENV=production`, la API no arranca. |
| `MERCADOPAGO_ACCESS_TOKEN` | Access token de la aplicación de [Mercado Pago](https://www.mercadopago.com.ar/developers/panel) con la que se cobra la suscripción. Sin ella la API arranca igual; sólo falla el checkout. **Secreto real, nunca commitear.** |
| `MERCADOPAGO_WEBHOOK_SECRET` | Clave secreta de las notificaciones de esa misma aplicación: con ella se verifica la firma `x-signature` de cada webhook. Sin ella, los webhooks se descartan. |
| `MERCADOPAGO_CLIENT_ID` | Client ID de esa misma aplicación de Mercado Pago, con OAuth habilitado. Con esto cada comercio conecta **su** cuenta desde `/cuenta` y el asistente de ventas cobra con links a su nombre. Sin ella, "Conectar Mercado Pago" queda deshabilitado y los pedidos quedan para cobrar a mano. |
| `MERCADOPAGO_CLIENT_SECRET` | Client secret de la aplicación, para canjear y renovar los tokens OAuth de los comercios. **Secreto real, nunca commitear.** En el panel de Mercado Pago, la Redirect URL tiene que ser `<API_PUBLIC_URL>/mercadopago/callback`. |
| `API_PUBLIC_URL` | Opcional. URL pública de la API (redirect del OAuth y `notification_url` de los links de pago). Por defecto, el origen de `GOOGLE_CALLBACK_URL`. |
| `MERCADOPAGO_BASE_URL` / `MERCADOPAGO_AUTH_URL` | Opcionales. `https://api.mercadopago.com` y `https://auth.mercadopago.com` por defecto; los E2E las apuntan al Mercado Pago falso (`e2e/mercadopago-stub`). |
| `SUSCRIPCION_PRECIO_ARS` | Importe mensual del plan en pesos. Por defecto `20000`. |

El frontend solo necesita `NEXT_PUBLIC_API_URL`, que sale del `.env` de la raíz.

## Tests

### Unitarios

```bash
docker compose exec api npm test    # vitest, todo mockeado
```

Los specs `*.db.spec.ts` (búsqueda del catálogo, reservas con `FOR UPDATE`,
histórico, retención, baja de cuenta) prueban SQL de verdad y corren sólo con
`TEST_DATABASE_URL` apuntando a una base ya migrada con pgvector; sin ella se
saltean. En CI la levanta el job de la API. En local, la URL de prueba sale
del `DATABASE_URL` que el contenedor ya tiene, cambiando sólo el nombre de la
base:

```bash
docker compose exec db createdb -U postgres trato_test
docker compose exec api sh -c 'DATABASE_URL="${DATABASE_URL%/*}/trato_test" npx prisma migrate deploy'
docker compose exec api sh -c 'TEST_DATABASE_URL="${DATABASE_URL%/*}/trato_test" npm test'
```

### Tests E2E (Playwright)

`e2e/` prueba el producto de punta a punta en un browser real: login dev, el
wizard de `/contanos` en escritorio y en móvil (incluido el perfil con cinco
tipos propios que rompía la generación vieja por IA), las validaciones, el
error de sesión vencida, el agente generado agendando, moviendo y cancelando
desde el chat de prueba, y el paso a `/vincular`. Del lado de ventas: el
onboarding de un comercio, la importación de una planilla con errores por fila,
una compra desde el chat de prueba con link de pago → pago en el Mercado Pago
falso → webhook firmado → venta pagada → aviso en la campanita → `/ventas` →
CSV, y los pedidos a coordinar que el dueño marca pagados o cancela.

Corren contra el stack de docker compose con `docker-compose.e2e.yml`, que suma
`e2e/openrouter-stub/server.mjs`: un OpenRouter falso y determinista, así que los
tests no gastan plata ni dependen de cómo redacte un modelo (también responde
`/embeddings` con vectores de bolsa de palabras); y `e2e/mercadopago-stub/server.mjs`,
un Mercado Pago falso con OAuth + PKCE, preferencias, una pantalla de pago con un
botón "Pagar" que dispara el webhook firmado, y la búsqueda de pagos. El override
usa su propio nombre de proyecto (`trato-e2e`), con una base aparte que migra sola
al arrancar.

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
por corrida, no corre con `npm test`). La generación de agentes ya no llama a
un modelo (plantilla determinista en `/contanos`), así que lo único que queda
para evaluar es el runtime conversacional:

- `conversacion.eval.ts`: el grafo conversacional completo con textos difíciles
  ("el jueves a la tardecita", "movelo una hora más tarde", pedidos para el
  sábado, preguntas de precio). Los checks miran el calendario final, no la
  redacción.
- `ventas.eval.ts`: el asistente de ventas con un catálogo de prueba y la
  búsqueda híbrida de verdad (embeddings reales), así que además necesita
  `TEST_DATABASE_URL` (la base de los `*.db.spec.ts`). Casos: precio y stock,
  errores de tipeo, compra completa, producto sin stock, producto que no
  existe, un cliente que dice que el dueño le prometió otro precio, una
  pregunta fuera de tema y una compra cancelada. Los checks miran los pedidos
  en la base, que todo monto con "$" salga del catálogo o del pedido, y que no
  se escapen tokens de la plantilla de chat (`<turn|>` y parecidos) al texto.

```bash
docker compose exec api npm run eval                      # lista corta de evals/modelos.ts
docker compose exec -e EVAL_MODELOS=deepseek/deepseek-v4-flash,google/gemma-4-26b-a4b-it api npm run eval -- conversacion
docker compose exec -e EVAL_NITRO=1 api npm run eval      # suma la variante :nitro de cada modelo
docker compose exec -e EVAL_MODELOS=google/gemma-4-31b-it api sh -c 'TEST_DATABASE_URL="${DATABASE_URL%/*}/trato_test" npm run eval -- ventas'
```

Primera corrida de `ventas` (2026-09-26, sólo `google/gemma-4-31b-it`): 6/8
casos. Los dos que fallaron eran checks del arnés demasiado estrictos ("no tiene
stock" no estaba en el regex; derivarle al dueño un precio "prometido" también
es correcto); corregidos, esos dos pasan. En esa pasada el modelo dejó un
`<turn|>` al final de una respuesta (de ahí el check `sinTokensDeControl`) y un
mensaje tardó 87 s y terminó en la disculpa genérica: conviene mirarlo en una
corrida completa, con todos los modelos, antes de sacar conclusiones.

Imprime una tabla por modelo (casos y checks aprobados, p50/p90 de latencia,
tokens, costo) y deja el detalle en `api/evals/resultados/`. Criterio sugerido: el
más barato con ≥ 95% de checks y p90 por mensaje < 8s. Cambiar de modelo en
producción es sólo tocar `OPENROUTER_MODEL` en Railway.

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

Recomendación a partir de estos números para el modelo conversacional:
`OPENROUTER_MODEL=qwen/qwen3.8-flash` (100% de checks con el p90 por mensaje
más bajo de los que aciertan todo). Es una sola pasada por caso: repetila antes
de decidir, y si cambiás de modelo, agregá `:nitro` para que OpenRouter elija
el proveedor más rápido.

(La mitad de esta corrida que comparaba modelos **de generación** —
`OPENROUTER_MODEL_AGENTES`, `inception/mercury-2.5` como candidato, etc. — ya
no aplica: la generación de agentes pasó a una plantilla determinista sin
modelo. Los números de generación de la tabla de arriba quedan como registro
histórico de la corrida del 2026-09-11, de antes de ese cambio.)

## Deploy

Producción vive en [Railway](https://docs.railway.com/), proyecto **trato-agenda**,
environment `production`: el plugin de Postgres más un servicio por carpeta, cada
uno con su `rootDirectory` (`/api`, `/web`) y su Dockerfile. Las dos imágenes
terminan en la etapa `prod`, así que Railway buildea la correcta sin `--target`.

| Servicio | Dominio |
| -------- | ------- |
| `web` | https://tratoagenda.com |
| `api` | https://api.tratoagenda.com |

Los dos son dominios propios (custom domains en Railway, certificado válido y DNS
propagado); los `*.up.railway.app` que Railway genera siguen respondiendo pero no
se usan. Que la API sea un **subdominio** del front no es cosmético: hace que la
cookie de sesión sea same-site y por eso `cookie.ts` la manda con
`sameSite: 'lax'`, lo que arregla el login en Safari/iOS. Además la verificación
OAuth de Google exige que la homepage y la política de privacidad estén en un
dominio propio verificado.

**El deploy es automático**: los dos servicios están conectados al repo de GitHub
en la rama `main`, así que cada push buildea y despliega. Los *watch paths*
(`api/**` y `web/**`) hacen que un cambio en el front no rebuildee la API y
viceversa. La imagen de la API corre `prisma migrate deploy` al arrancar, así que
las migraciones también viajan solas (el healthcheck es `/health`, con 300s de
timeout para que la migración entre). La del catálogo corre
`CREATE EXTENSION IF NOT EXISTS vector` y `pg_trgm`: la imagen del Postgres de
Railway (`postgres-ssl:18`) ya trae pgvector, así que no hay que tocar la base.

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

### Cuatro cosas que hay que hacer a mano

1. **Consola de Google**: autorizar
   `https://api.tratoagenda.com/auth/google/callback` como *redirect URI* y
   `https://tratoagenda.com` como *JavaScript origin*. El estado de la
   verificación OAuth y lo que falta para reenviarla están en
   [`docs/verificacion-google.md`](docs/verificacion-google.md).
2. **Mercado Pago**: apuntar el webhook de la aplicación a
   `https://api.tratoagenda.com/suscripcion/webhook`. (El de las ventas no se
   configura: cada link de pago lleva su propio `notification_url`.)
3. **Mercado Pago, OAuth de los comercios**: en la misma aplicación, con OAuth
   habilitado, registrar la Redirect URL
   `https://api.tratoagenda.com/mercadopago/callback`, y cargar
   `MERCADOPAGO_CLIENT_ID` y `MERCADOPAGO_CLIENT_SECRET` en el servicio `api`.
   Sin ellas la API arranca igual y "Conectar Mercado Pago" aparece
   deshabilitado: los pedidos quedan para cobrar a mano.
4. **Railway GitHub App**: darle acceso al repo si todavía no lo tiene.

### Dos límites que conviene tener presentes

- **La API no escala a más de una réplica.** `WhatsappService.onModuleInit` resume
  todas las sesiones vinculadas al arrancar; con dos réplicas habría dos sockets
  de Baileys peleándose la misma sesión. Por lo mismo, `sleepApplication` está en
  `false`: el socket tiene que seguir vivo entre mensajes. Los límites de abuso
  del alta y del login con WhatsApp (`api/src/auth/limitador.ts`) también viven
  en memoria por esta misma razón, y leen la IP real porque `main.ts` pone
  `trust proxy` en 1 (el proxy de Railway): si se agrega otro proxy adelante,
  hay que subir ese número. Lo mismo vale para los barridos del comercio (el
  indexador de embeddings cada 10 minutos, la conciliación de pagos y el
  vencimiento de reservas cada 5) y para el `state` del OAuth de Mercado Pago,
  que vive en memoria 10 minutos.
- **La cookie de sesión depende de que front y API compartan sitio.**
  `opcionesDeCookie` (`api/src/auth/cookie.ts`) compara `FRONTEND_URL` con
  `GOOGLE_CALLBACK_URL` y usa `sameSite: 'lax'` sólo si una es el mismo host o un
  subdominio de la otra — que es el caso hoy (`tratoagenda.com` +
  `api.tratoagenda.com`), y es lo que hace que el login funcione en Safari/iOS.
  Si algún día vuelven a dos subdominios hermanos de `up.railway.app` (que está en
  la Public Suffix List, así que **no** son el mismo sitio) cae solo a
  `sameSite: 'none'` + `secure`, y ahí Safari bloquea la cookie de nuevo. Con
  `none` la API queda sin la defensa de CSRF del browser, así que
  `main.ts` monta `chequeoDeOrigen` (`api/src/auth/csrf-origin.ts`): todo método
  que cambia estado con un `Origin` que no es `FRONTEND_URL` se corta con 403. Un
  pedido sin `Origin` pasa a propósito: así llega el webhook de Mercado Pago, que
  se autentica por firma y no por la cookie.

## Seguridad

`api/.env` tiene credenciales vivas de Google y las claves de firma y cifrado.
Está cubierto por `.gitignore` en la raíz y en `api/`. Antes de commitear, el
subagente `security-auditor` (en `.claude/agents/`) revisa el staging en busca de
secretos; `committer` arma los commits y aborta si detecta un `.env` en el índice.
