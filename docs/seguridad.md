# Seguridad: scan del 2026-09-26 y controles automáticos

Qué se revisó, qué se encontró, qué se arregló y qué queda pendiente. Los
controles que corren solos están en `.github/workflows/security.yml` y
`.github/dependabot.yml`.

## Qué se revisó

- **Dependencias**: `npm audit` de `api/`, `web/` y `e2e/` (producción y desarrollo).
- **Secretos**: el historial completo de git, buscando archivos `.env`, claves
  privadas y patrones de credenciales (Google, OpenRouter, Mercado Pago, GitHub,
  AWS). No apareció ninguno: sólo `.env.example`, que no tiene valores reales.
- **Código de la API**: autenticación (JWT en cookie, scrypt, códigos de
  acceso), CSRF (`csrf-origin.ts`), cookies, cifrado del refresh token
  (AES-256-GCM), firma del webhook de Mercado Pago, validación de entorno,
  autorización por dueño en `/calendar/eventos/:id` (IDOR), SQL crudo.
- **Web**: sinks de XSS (`dangerouslySetInnerHTML`, `eval`), cabeceras HTTP.
- **Contenedores**: `api/Dockerfile` y `web/Dockerfile`.

## Hallazgos y estado

| # | Severidad | Hallazgo | Estado |
|---|-----------|----------|--------|
| 1 | Alta | `undici` 6.20.1 (vía `openai` y `@nestjs/mau`): 15 avisos, entre ellos request smuggling, CRLF injection y DoS por WebSocket. | **Arreglado**: override a `^6.29.0`. |
| 2 | Alta | `multer` ≤ 2.2.0 (vía `@nestjs/platform-express`): DoS con nombres de campo armados y fuga de descriptores. | **Arreglado**: `@nestjs/platform-express` 12.1.0 → `multer` 2.4.0. |
| 3 | Alta | `mysql2` 3.15.3 y `deepmerge-ts` 7.1.5 (vía `prisma`): downgrade de auth a texto plano; stack exhaustion. La API usa Postgres, pero viajan en la imagen. | **Arreglado**: overrides a `mysql2 ^3.24.4` y `deepmerge-ts ^8.0.2`. `prisma generate`/`validate` y los 384 tests pasan. |
| 4 | Alta (dev) | `tmp` 0.0.33 (vía `@nestjs/mau` → `inquirer`): path traversal. | **Arreglado**: override a `^0.2.6`. |
| 5 | Media | Las imágenes de producción corrían como `root` y traían npm, corepack y yarn (con `tar`, `brace-expansion` e `ip-address` vulnerables adentro), que el runtime no usa. | **Arreglado**: `USER node`; el código queda de root (sólo lectura) y en la web sólo `.next` es escribible (cache de `next/image`). Se borran npm/npx/corepack/yarn y se hace `apk upgrade`; la API corre `prisma` directo desde `node_modules/.bin`. CI verifica que la imagen no sea root y Grype la escanea. |
| 6 | Media | La web no mandaba `X-Frame-Options` ni `frame-ancestors`: `/cuenta` (borrar la cuenta) y `/vincular` se podían embeber en un iframe (clickjacking). | **Arreglado**: cabeceras en `web/next.config.ts` (más `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS) y `poweredByHeader: false`. |
| 7 | Baja | La API no mandaba cabeceras de seguridad y anunciaba `X-Powered-By: Express`. | **Arreglado**: `api/src/security-headers.ts` (`nosniff`, `DENY`, CSP `default-src 'none'`, `no-referrer`) y `x-powered-by` apagado. |
| 8 | Media | Cambiar la contraseña (o recuperarla por código) **no invalida las sesiones abiertas**: un JWT robado sigue valiendo hasta 7 días aunque el dueño ya haya cambiado la clave. | **Pendiente**: requiere un `User.sesionVersion` (migración) que viaje en el JWT y se compare en `JwtStrategy.validate`, incrementado en `POST /auth/password`, en la verificación del código y en `/auth/logout`. |
| 9 | Baja | El webhook de Mercado Pago verifica la firma pero no la antigüedad de `ts`, así que una notificación firmada se puede reenviar. | **Aceptado por ahora**: el handler ignora el cuerpo y vuelve a leer el preapproval de la API de MP, así que un replay no cambia nada. Si se quiere cerrar, rechazar `ts` con más de ~5 minutos. |
| 10 | Info | Sin CSP completa en la web (sólo `frame-ancestors`). | **Pendiente**: una CSP con nonces en Next 16 necesita `proxy.ts`; ver la doc de Next en `web/node_modules/next/dist/docs/` antes de encararlo. |
| 11 | Info | `npx tsc --noEmit -p tsconfig.json` en `api/` falla en dos specs (`turnos-del-dueno.spec.ts`, `test/app.e2e-spec.ts`). No afecta al build (`tsconfig.build.json`) ni a vitest. | **Pendiente**: CI chequea tipos con `tsconfig.build.json`. |
| 12 | Media | Sentry v11 junta por defecto bodies, cookies, query strings, variables locales de cada frame y las entradas/salidas de los modelos: con la configuración por defecto, un error del grafo habría mandado la conversación del cliente a un tercero. | **Arreglado al integrarlo**: `dataCollection` todo apagado, integraciones de IA fuera (`api/src/instrument.ts`) y `limpiarEvento`/`limpiarSpan`/`limpiarBreadcrumb` (`api/src/observabilidad/scrubbing.ts`, con tests) como segunda barrera. Revisar esto en cada major del SDK. |
| 13 | Alta | `brace-expansion` (2026-10-05, GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p): DoS por expansión cuadrática y recursión. En la API llega a producción vía `@sentry/nestjs` → `glob` → `minimatch`, y por eso también lo marcaba Grype en la imagen. | **Arreglado**: `npm audit fix --package-lock-only` en `api/` (5.0.12) y `web/` (1.1.21 / 5.0.12), sin tocar dependencias directas. |
| 14 | Alta (dev) | `braces` (2026-10-05, GHSA-vfj7-8cjw-p6xm): stack exhaustion con patrones muy anidados, en **todas** las versiones. En la web llega sólo por el lint (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`), sobre archivos propios, y no viaja en la imagen (Grype web pasa). | **Exceptuado hasta el parche**: entrada en `.github/npm-audit-excepciones.json` (revisar el 2026-11-05). `npm audit fix --force` no sirve: baja `eslint-config-next` a 14. La excepción vence sola cuando npm puede arreglarlo, y ahí alcanza con `npm audit fix --package-lock-only` en `web/` y borrar la entrada. |
| 15 | Crítica | `proxy-addr` (GHSA-jqcg-44mw-7w3h): IP spoofing con direcciones IPv4 mapeadas en IPv6 dentro de una subred de confianza. Llega a la API por Express, que lo usa para `req.ip` con `trust proxy` (`main.ts`), y de `req.ip` dependen los límites por IP del alta y del login. Con él, `sharp` (GHSA-wq5f-xc86-pv6w, librsvg) y `source-map-js` (GHSA-68fv-2mgg-jv7q, DoS) en `api/` y `web/`. | **Arreglado** (2026-10-07): `npm audit fix --package-lock-only` en `api/` y `web/` (`proxy-addr` 2.0.8, `sharp` 0.35.5, `source-map-js` 1.2.2), sin tocar dependencias directas. |
| 16 | Alta | `zlib` 1.3.2-r0 en las dos imágenes (CVE-2026-85091, arreglado en 1.3.2-r1). El `RUN apk upgrade` de la etapa `prod` salía del cache de BuildKit, que lo reusa mientras no cambien la imagen base ni el comando: los paquetes del sistema quedaban congelados en el primer build. | **Arreglado en CI** (2026-10-07): el build que escanea Grype pasa `no-cache-filters: prod`, así que `apk upgrade` corre siempre. **Pendiente en Railway**: su build también cachea capas; si una imagen desplegada queda vieja, redeployar sin cache. |

Lo que se revisó y está bien: el CSRF por `Origin` más cookies `httpOnly`/`secure`;
la validación de entorno que rechaza `DEV_LOGIN_PASSWORD` en producción; el
refresh token cifrado con GCM e IV aleatorio; scrypt con `timingSafeEqual` y
hash falso para no delatar números; `ValidationPipe` con `whitelist`; los
eventos locales se buscan siempre por `userId` antes de editar o borrar; el
SQL crudo (búsqueda del catálogo, reservas, histórico) va siempre por
`$queryRaw`/`$executeRaw` con template tags, que parametrizan, y nunca por las
variantes `Unsafe`; no hay `dangerouslySetInnerHTML`.

## Módulo de ventas (2026-09-26)

Lo que agrega superficie nueva y cómo está cubierto:

- **Webhook de pagos de ventas** (`POST /ventas/webhook`, sin guard como
  `/suscripcion/webhook`): verifica `x-signature` con `firmaDeWebhookValida`,
  ignora el cuerpo y vuelve a pedir el pago a Mercado Pago con el token del
  vendedor dueño de la `Venta`. Sólo la marca pagada si `pagoSaldaVenta`: pago
  aprobado, `external_reference` igual al id de la venta y **mismo monto y
  moneda**. Idempotente por `Venta.mpPaymentId` (único) y siempre responde
  200. Un replay no cambia nada, igual que en el hallazgo 9.
- **Conciliación** cada 5 minutos (`conciliacion.service.ts`): busca los pagos
  por `external_reference` de las ventas con link vigente o vencido hace menos
  de 24 horas y aplica la misma regla. Cubre un webhook perdido o que no pase
  la firma (ver pendiente abajo).
- **OAuth de Mercado Pago** (`GET /mercadopago/conectar` → `/callback`): PKCE
  S256 y `state` aleatorio guardados del lado del servidor por 10 minutos y
  atados a la sesión que empezó la conexión; un callback con otro usuario o un
  `state` desconocido se rechaza. Los tokens se guardan cifrados con
  AES-256-GCM (`encryptToken`), nunca salen del backend ni llegan al modelo, y
  se renuevan solos cuando les quedan menos de 7 días. Un 401 de Mercado Pago
  desconecta la cuenta y avisa al dueño. El cuerpo de error de `/oauth/token`
  no se loguea.
- **El precio nunca sale del modelo**: `crear_pedido` recibe sólo
  `varianteId` + `cantidad`; la validación exige que la variante sea del dueño
  y esté activa, y el total lo calcula el código desde la base.
- **Reservas**: se toman en una transacción con `SELECT … FOR UPDATE` sobre las
  variantes, así dos pedidos por la última unidad se serializan
  (`ventas.db.spec.ts` lo prueba). Topes para que un cliente no bloquee el
  stock: 2 pedidos pendientes por conversación, 10 renglones, 50 unidades por
  renglón, 30 minutos con link y 24 horas a coordinar.
- **Avisos**: `derivar_consulta` tiene un tope de 1 cada 6 horas por
  conversación y el texto se corta a 300 caracteres; los avisos de stock no se
  repiten mientras haya uno sin leer.
- **Export CSV** (`GET /ventas/export.csv`): las celdas que empiezan con `=`,
  `+`, `-`, `@`, tab o retorno llevan un apóstrofo adelante (CSV injection: el
  nombre del cliente lo escribe cualquiera por WhatsApp), y la respuesta va con
  `Cache-Control: no-store`.
- **Importación**: el límite de cuerpo de 6 MB vale sólo para
  `POST /productos/importar` (el resto sigue con el de Express), con un tope de
  5.000 filas. Los Excel se leen en el navegador con `read-excel-file`, no con
  el paquete `xlsx` de npm (avisos abiertos y sin parches en el registro).
- **Embeddings**: el texto de cada búsqueda es conversación del cliente, así
  que `embeddings.client.ts` manda `POLITICA_DE_PROVEEDOR` (ZDR) igual que el
  resto de las llamadas a OpenRouter.
- **Autorización**: todo lo de `/productos`, `/ventas` y `/notificaciones`
  filtra por el `userId` de la sesión (un id ajeno da 404, no el dato).
- **Retención y baja**: las ventas pierden nombre y teléfono del cliente a los
  12 meses y los avisos se purgan (leídos a los 90 días, el resto a los 12
  meses); la baja de cuenta se lleva catálogo, ventas, avisos y tokens de
  Mercado Pago por cascada (`cuenta.db.spec.ts`).

Pendiente:

- **Firma de las notificaciones de pagos creados con OAuth**: la documentación
  de Mercado Pago no deja claro si se firman con el secreto de nuestra
  aplicación. Si no, el webhook las descarta por firma inválida y la venta se
  registra igual en la próxima conciliación (hasta 5 minutos de demora).
  Verificarlo con un pago real en sandbox antes de relajar nada.
- El `state` del OAuth vive en memoria: un reinicio de la API en medio de la
  conexión obliga a empezarla de nuevo. Aceptable por la réplica única.
- La baja de cuenta borra los tokens de Mercado Pago pero no revoca la
  autorización del lado de Mercado Pago; `/privacidad` le dice al vendedor que
  la quite desde su cuenta.

## Fotos de productos (2026-10-09, LAU-10)

El dueño sube una foto por producto y el asistente de ventas se la manda al
cliente que la pide (`enviar_imagen_producto`). Superficie nueva y cómo está
cubierta:

- **Subida** (`PUT /productos/:id/imagen`, multipart con `FileInterceptor` de
  `@nestjs/platform-express`): multer en memoria con tope de 2 MB, un solo
  archivo y ningún otro campo; el producto tiene que ser del `userId` de la
  sesión (404 si no) y el chequeo de `Origin` de `main.ts` cubre el `PUT`.
- **Validación por contenido, no por nombre**: `formatoPorFirma`
  (`comercio/imagenes.rules.ts`) mira los primeros bytes y sólo deja pasar
  JPEG, PNG y WebP antes de entregarle el archivo a sharp, que sabe leer
  muchos más formatos (SVG, TIFF, PDF…). Después sharp tiene que coincidir con
  esa firma, con `limitInputPixels` de 25 MP contra las bombas de
  descompresión.
- **Nunca se guarda ni se sirve lo que subió el dueño**: se recomprime a JPEG
  de 800 px, ≤ 150 KB y **sin metadatos** (EXIF con GPS, ICC). `GET
  /productos/:id/imagen` responde siempre `image/jpeg` con las cabeceras de
  seguridad globales (`nosniff`, CSP `default-src 'none'`).
- **Tope de almacenamiento**: una foto por producto y 100 productos con foto
  por cuenta, contados en una transacción con `SELECT … FOR UPDATE` sobre el
  `User` (`imagenes.db.spec.ts` prueba dos subidas simultáneas por el último
  lugar). Tabla aparte (`ImagenProducto`) para que ningún listado lea los
  bytes. Dar de baja el producto borra su foto; la baja de cuenta, por cascada.
- **El modelo no elige qué bytes salen**: la herramienta recibe sólo un
  `productoId`; el nodo `catalogo` comprueba que sea un producto activo del
  dueño con foto y deja en el `ToolMessage` un `artifact` con id y nombre
  (nunca los bytes, que no llegan al checkpoint). `WhatsappService` vuelve a
  leer la foto filtrando por dueño y producto activo antes de mandarla. Tope
  de 2 fotos por respuesta (`MAX_IMAGENES_POR_MENSAJE`). Una foto que falla se
  loguea con ids y el texto sale igual.

## Code scanning (2026-09-29)

Las alertas abiertas en *Security → Code scanning* se reprodujeron corriendo
CodeQL 2.27.1 (la misma versión del workflow) con `security-extended` y los
mismos `paths-ignore`. Grype no tenía hallazgos fuera de los ignorados en
ninguna de las dos imágenes, así que todas eran de CodeQL:

| Regla | Dónde | Arreglo |
|-------|-------|---------|
| `js/insufficient-password-hash` (2) | `api/src/auth/dev-auth.controller.ts`, `contrasenaCorrecta` | Hasheaba la contraseña de login dev con SHA-256 sólo para igualar largos antes de `timingSafeEqual`. Ahora copia las dos a buffers del mismo largo y compara el largo aparte, sin hash. Test nuevo para el relleno de ceros. |
| `js/insecure-randomness` (1) | `e2e/tests/fixtures.ts`, `telefonoUnico` | `Math.random()` → `randomInt` de `node:crypto`. Es un número de prueba, pero entra al login y CodeQL lo trata como contexto de seguridad. |
| `js/remote-property-injection` (13) | `docs/agentes-whatsapp.html` | Es un diagrama generado por archify con su JS embebido (mapas `{}` indexados por ids de la URL). No se despliega y se pisa al regenerarlo, así que se excluye con `paths-ignore` en el job de CodeQL en vez de parchear código generado. |

Con eso el análisis local da 0 resultados en JavaScript/TypeScript y en Actions.
Las alertas se cierran solas cuando el cambio llega a `main` y corre Seguridad.

Para que no vuelva a pasar, cada prompt de Claude Code que deja cambios sin
pushear termina con una validación: el hook `Stop` de `.claude/settings.json`
(`.claude/hooks/validar-seguridad.sh`) pide correr en paralelo los subagentes
`revisor-seguridad` (vulnerabilidades: lo que marcaría CodeQL más los controles
de este documento) y `security-auditor` (secretos), y arreglar lo HIGH/MEDIUM
antes de terminar. Guarda una huella del diff para no repetir la revisión del
mismo estado y corta a las 3 rondas por prompt.

## Pruebas de seguridad por el chat (2026-10-01)

Mientras alguien probaba los límites del bot por WhatsApp, Sentry abrió
TRATO-API-2: `TypeError: Cannot read properties of undefined (reading
'message')` en `ConversacionNode`, cuatro veces en la misma conversación.
OpenRouter había contestado HTTP 200 **sin `choices`** (el proveedor bloqueó o
falló y el motivo venía en `error` dentro del cuerpo); `@langchain/openai` lo
convierte en una lista vacía y `@langchain/core` revienta al leerla. No hubo
daño: el nodo atrapó el error y mandó la disculpa genérica, sin tocar la agenda.
Pero el motivo se perdía, el caso se reportaba como bug y el cliente recibía
"probá de nuevo en un rato".

Ahora:

- `fetchQueRechazaRespuestasVacias` (`api/src/conversation/respuesta-sin-choices.ts`),
  montado en `llm.provider.ts`, convierte ese 200 en un error HTTP con el código
  del cuerpo (o 502), y `clasificarFalloDelModelo` lo separa en
  `rechazo_contenido` (403 o moderación) y `sin_respuesta`.
- El nodo de conversación lo registra como **warning** en Sentry con el
  mensaje "El proveedor del modelo no respondió", fingerprint
  `modelo-sin-respuesta` + motivo y las etiquetas `motivo`, `codigo`,
  `proveedor`, `conversacion` y `user.id` (el dueño de la cuenta). Nunca el
  texto del cliente: ni `error.message` ni `metadata.raw`/`flagged_input`.
  Para verlos: `level:warning motivo:rechazo_contenido` en Issues; agrupar por
  `conversacion` muestra quién está insistiendo.
- Un rechazo por moderación contesta `MENSAJE_FUERA_DE_ALCANCE` ("Con eso no te
  puedo ayudar…"), que no invita a reintentar. Un `sin_respuesta` sigue con la
  disculpa genérica, porque puede ser una caída transitoria del proveedor.
- Cualquier otro fallo del modelo (timeout, credenciales) sigue como antes:
  `logger.error` y evento de nivel error.

Cómo registrar los casos de una prueba de seguridad: pedirle al tester el texto
de cada intento y convertir cada uno en una fila de
`api/evals/adversarial/matriz/matriz-cobertura.csv` (sección C, regenerar el
resumen con `npx tsx evals/adversarial/matriz/calcular-resumen.ts`) más un spec
determinista en `api/src/conversation/graph/adversarial/` que simule la
respuesta del modelo y verifique que no se ejecuta ninguna acción. Las
conversaciones reales no se guardan en ningún lado para esto: lo promete
`/privacidad`. Casos de esta ronda: C-021 y C-022
(`rechazo-proveedor.spec.ts`, `respuesta-sin-choices.spec.ts`).

## Hilos rotos y precios inventados (2026-10-06)

TRATO-API-3 (warning `modelo-sin-respuesta`, `sin_respuesta` 502) se repitió 7
veces en **una sola** conversación entre el 1/10 y el 5/10: cada mensaje nuevo
del cliente fallaba igual. El nodo de conversación le mandaba al modelo el hilo
**entero** del checkpointer, sin límite; un hilo que quedó cortado a mitad de una
vuelta (un `AIMessage` con tool calls sin su `ToolMessage`, por ejemplo cuando se
agota `LIMITE_RECURSION` buscando una y otra vez un producto que no está) queda
como una secuencia que el proveedor rechaza para siempre. Ahora:

- `api/src/conversation/graph/ventana-historial.ts` decide qué parte del hilo ve
  el modelo: sólo lo que llegó dentro de `HISTORIAL_IA_VENTANA` (por defecto
  `14d`), cortando siempre en un mensaje del cliente, y sin pares tool
  call/resultado cortados (`sinParesCortados`). Nada se borra: es sólo lo que se
  manda. Con historial fuera de la ventana tampoco va `Conversation.resumen`.
  Menos datos viejos del cliente hacia el modelo, de paso.
- Cada mensaje del cliente queda marcado con su hora en
  `response_metadata.recibidoEn`, que `@langchain/openai` no manda al proveedor.
  Los mensajes de antes de este cambio no tienen marca y cuentan como viejos.
- En ventas, `buscar_productos` tiene un tope de 3 por mensaje
  (`MAX_BUSQUEDAS_POR_MENSAJE`) para no agotar las vueltas, `crear_pedido` sólo
  acepta variantes que salieron de una búsqueda visible, y el nodo
  `verificar_respuesta` descarta una respuesta con un monto `$ …` que no sale del
  catálogo, de los pedidos ni de lo que escribió el cliente: el modelo la
  reescribe con una nota de corrección, y si insiste se contesta
  `MENSAJE_PRECIO_SIN_VERIFICAR` y se avisa a Sentry (warning
  `precio-sin-respaldo`, sólo ids y la cantidad de montos, nunca el texto).

## Controles automáticos

**`ci.yml`** (PRs y `main`): lint, tipos, tests y build de `api/`; lint, tipos y
build de `web/`; tipos de `e2e/`; build de las imágenes de producción
verificando que no corran como root; y los E2E de Playwright contra el stack
de compose con un `api/.env` de mentira generado en el momento.

**`security.yml`** (PRs, `main` y los lunes):

- `npm audit` por paquete: falla desde *moderate* en producción y desde *high*
  en desarrollo; más `npm audit signatures` sobre lo instalado. El paso de
  desarrollo pasa por `.github/scripts/npm-audit-con-excepciones.mjs`, que admite
  las excepciones de `.github/npm-audit-excepciones.json`: cada una cubre un solo
  GHSA de un paquete, en las carpetas que lista (`en`), sólo mientras no haya parche y hasta su fecha `revisar`;
  pasado cualquiera de los dos, el job vuelve a fallar. El paso de producción no
  admite excepciones.
- CodeQL (`security-extended`) sobre TypeScript y sobre los propios workflows.
- TruffleHog sobre los commits nuevos (y todo el historial en el cron).
- Dependency Review en PRs: frena dependencias nuevas vulnerables o con
  licencias GPL/AGPL. Queda salteado hasta que se prenda el Dependency graph y
  la variable `DEPENDENCY_REVIEW=on` (ver pasos manuales).
- Grype sobre las imágenes de producción, con los resultados en la pestaña
  *Security → Code scanning*.
- OWASP ZAP baseline (escaneo pasivo, sin autenticar) contra el front y la API
  levantados con compose (override de e2e, `api/.env` de mentira). Falla ante
  cualquier alerta WARN/FAIL que no esté en `.zap/rules.tsv`; los reportes HTML/JSON
  quedan como artifact `zap-reportes`. Limitación: el stack corre en modo dev, así
  que las cabeceras y errores no son idénticos a producción.
- actionlint sobre los workflows.

**`dependabot.yml`**: PRs semanales agrupados para npm (`api`, `web`,
mensual para `e2e`), las imágenes base de Docker y las Actions.

Todas las Actions de terceros están fijadas por SHA de commit (con la versión
en un comentario), con `permissions` mínimos y `persist-credentials: false`.
Para las imágenes se eligió Grype y no `trivy-action`, que tuvo un compromiso
de supply chain (tags reescritos) en 2026.

## Pasos manuales en GitHub

1. *Settings → Branches*: proteger `main` exigiendo los checks de CI y
   Seguridad antes de mergear.
2. *Settings → Code security*: prender Dependency graph, Dependabot alerts,
   secret scanning y push protection (gratis en repos públicos).
3. *Settings → Secrets and variables → Actions → Variables*: crear
   `DEPENDENCY_REVIEW` con valor `on`, que activa el job de Dependency Review
   (sin el Dependency graph prendido ese job falla).
