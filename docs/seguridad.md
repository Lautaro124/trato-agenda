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
- **Datos del cliente en el pedido** (`datos-cliente.rules.ts`, 2026-10-10):
  el comercio elige qué pide (código postal, dirección, provincia, país, email,
  DNI o hasta 5 campos propios). Las etiquetas propias son texto del dueño y
  entran al prompt con `JSON.stringify`; lo que contesta el cliente se valida
  contra esa configuración en el nodo `validacion` (lo que el comercio no pidió
  se descarta, así el modelo no puede guardar otros datos), se recorta a 200
  caracteres y queda en `Venta.datosCliente`. No viaja en los avisos (sólo
  "con envío"/"lo retira"), no se loguea, y en el CSV pasa por `celdaCsv`.
  Lo que el cliente escribió también queda en `Message` y en los checkpoints
  (90 días de inactividad) y puede repetirse en `Conversation.resumen` (12
  meses): las ventanas de retención de siempre, no una nueva.
- **Retención y baja**: las ventas pierden nombre, teléfono y datos del cliente
  (`Venta.datosCliente`) a los 12 meses y los avisos se purgan (leídos a los 90 días, el resto a los 12
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

## Importación rápida de productos (2026-10-21, LAU-31)

Es la primera vez que la API pide URLs que escribe un usuario: el dueño pega
enlaces de Mercado Libre, Tiendamia o su tienda, y la API los lee para armar
productos. Todo vive en `api/src/importacion/` y cualquier salida a la red
pasa por `fetch-seguro.ts`:

- **SSRF**: `revisarUrl` (`ssrf.rules.ts`) sólo acepta https al puerto 443, sin
  usuario ni contraseña, con un nombre (nunca una IP escrita, en ninguna de sus
  formas) que no sea interno (`localhost`, `*.local`, `*.internal`,
  `*.railway.internal`, sin punto). Después del DNS, **todas** las direcciones
  tienen que pasar `ipPermitida`: lista de permitidos (IPv4 fuera de privadas,
  loopback, link-local/metadata, CGNAT, documentación, multicast, reservadas;
  IPv6 sólo global unicast `2000::/3` sin sus rangos reservados), con las IPv4
  escondidas en IPv6 (mapeadas, NAT64, 6to4) desenvueltas. La conexión va a la
  IP ya revisada (`lookup` fijo), así que un DNS que cambia entre la revisión
  y el connect (rebinding) no sirve. Redirecciones a mano, como mucho 3, cada
  una revisada de nuevo.
- **Topes**: 10 s por pedido (también contra el goteo lento), 2 MB de HTML
  contados ya descomprimido (una gzip bomb corta igual), 1 MB de JSON de
  Mercado Libre, 2 MB por foto; sólo los content-types esperados.
- **Listados**: de un listado genérico sólo se siguen enlaces del mismo host,
  como mucho 20 (50 en Mercado Libre, por su API), de a 4. Si la búsqueda de
  la API de Mercado Libre no responde, de la página de la tienda sólo se sacan
  ids de publicación del mismo sitio (`idsDePaginaDeTienda`), que se leen por
  la API: la página no aporta otra URL que se pida.
- **Landings sin datos de producto**: las secciones (`secciones.rules.ts`) se
  leen con el mismo recorrido lineal, y sus fotos pasan por `revisarUrl`. Si no
  hay secciones, la IA (`extraccion-ia.ts`) recibe el texto visible (≤ 30 000
  caracteres) como dato entre `<pagina>`, con `POLITICA_DE_PROVEEDOR`, y
  devuelve JSON con schema estricto: elige fotos por número de una lista armada
  en la API (nunca escribe una URL) y su texto pasa por `textoSeguro` como el
  resto. Una instrucción inyectada en la página como mucho cambia nombres o
  descripciones que el dueño revisa antes de confirmar; no puede hacer pedir
  otras URLs ni poner precios.
- **Uso**: 30 enlaces y 60 productos confirmados por hora por cuenta, una
  extracción a la vez por cuenta y 5 en toda la API (`Limitador`, en memoria:
  alcanza por la réplica única).
- **Confirmar no es un descargador**: la vista previa vuelve firmada (HMAC con
  subclave de `TOKEN_ENCRYPTION_KEY` sobre cuenta, origen, fotos y fecha, 1 h,
  `firma.ts`); `POST /importacion/confirmar` no baja ninguna foto ni guarda un
  origen que no salió de una extracción de esa misma cuenta.
- **Texto ajeno hacia el modelo**: nombre y descripción los escribió un
  tercero y el asistente los lee en cada búsqueda. `textoSeguro`
  (`texto.rules.ts`) los deja en texto plano acotado y saca caracteres
  invisibles y bidi, la frase de "mandar tal cual", los marcadores internos
  (`[producto …]`, `[variante …]`, `[pedido …]`) y, en las descripciones, los
  montos: `preciosSinRespaldo` acepta cualquier monto de un resultado de
  búsqueda, y un "$ 1" en la descripción respaldaría un precio inventado. El
  dueño revisa y edita todo antes de confirmar.
- **Fotos**: la elegida se baja por la misma descarga segura y pasa por
  `ImagenesService.guardar` (firma de bytes, recompresión sin metadatos, tope
  de 100 por cuenta). En la vista previa el navegador muestra las de la página
  de origen con `referrerPolicy="no-referrer"`.
- **Acceso**: cuenta de ventas (409) con el plan Pro pagando (403,
  `motivo: plan_pro_requerido`), chequeado en la API en cada pedido.
- **Logs**: sólo el código de error (y, para Mercado Libre, un subcódigo
  como `sin_credenciales+muro`); nunca el host, la ruta, la query, el contenido
  de una página ni la respuesta de la IA.
- **Sólo e2e**: `IMPORTACION_HOSTS_DE_PRUEBA` habilita el stub (http, red de
  compose); `validateEnv` no deja arrancar con eso en producción, y exige
  `MERCADOLIBRE_API_URL` https.
- **CodeQL** puede marcar `js/request-forgery` en `fetch-seguro.ts`: pedir la
  URL del usuario es el objetivo de la función y la guarda es la de arriba
  (cubierta por `ssrf.rules.spec.ts` y `fetch-seguro.spec.ts`, que prueban
  redirecciones a la metadata, DNS mezclado, IPv4 mapeada, gzip bomb y goteo).

## Rendimiento de productos y chats (2026-10-22, LAU-30)

El módulo de performance (`api/src/performance/`, definiciones en
`docs/performance.md`) guarda, por chat de ventas, la etapa, los productos que
vio o pidió y la **provincia** del cliente. La provincia es un dato personal
mientras la fila está atada a la conversación (que tiene el número):

- **Qué se guarda.** Sólo una clave de provincia (`EtapaChat.provincia`) y su
  origen:
  - `dato`: sale del campo provincia o del código postal con letra que dio el cliente en un pedido;
  - `inferida`: sale de la característica de un celular argentino.

  Nunca se guardan el número, la dirección ni el texto del cliente.
- **Dónde se calcula.** `zona.rules.ts` es puro y local: el número no sale a
  ningún servicio, y los logs del registro llevan sólo ids.
- **Retención.** A los 12 meses `RetentionService.desligarPerformance` pone la
  conversación en null. La provincia queda sólo como conteo de la cuenta. Está
  publicado en `/privacidad`.
- **Preguntas de los clientes.** `PreguntasPerformanceService` clasifica cada
  chat una sola vez, cuando queda quieto 48 horas o paga.
  - `clasificadaAt` se reserva con un `updateMany` condicional antes de
    llamar, así dos pasadas no mandan el mismo chat; si el llamado falla no
    se reintenta.
  - Va un único llamado a OpenRouter con `POLITICA_DE_PROVEEDOR` y el modelo
    de siempre (sin `response_format`, para no achicar los proveedores ZDR).
  - Se mandan sólo los últimos mensajes de texto, saneados en código por
    `sanear` (emails, URLs y números de 7 o más dígitos; es de mejor
    esfuerzo, no detecta nombres), cada uno como dato (`JSON.stringify`).
  - La respuesta se valida en código: tema fuera del catálogo → `otro`,
    producto que el chat no vio → null, texto saneado otra vez, máximo 10.
  - Los logs llevan el id de `EtapaChat` y `resumenDeError`.
  - El texto guardado se borra a los 90 días (`purgarPreguntas`).
- **Lectura.** `GET /performance` filtra cada consulta por el `userId` de la
  sesión, usa SQL con parámetros (el filtro de zona es `Prisma.sql`, validado
  contra la lista de zonas en el DTO) y devuelve conteos, sin nombres,
  teléfonos ni ids de conversación.

## Vincular con código desde el celular (2026-10-11, LAU-11)

Un celular no puede escanear el QR de su propia pantalla, así que
`/vincular` y el alta ofrecen el código de "Vincular con el número de
teléfono" (`requestPairingCode` de Baileys). Superficie nueva:

- **Endpoints**: `POST /whatsapp/link/codigo` (sesión, `JwtAuthGuard`) y
  `POST /auth/whatsapp/alta/codigo` (cookie del alta, `AltaGuard`), los dos
  con `{ telefono }` validado por `SolicitarCodigoDto` (8 a 15 dígitos). El
  alta sigue limitada por IP y por altas simultáneas al crearla; el código no
  abre más sockets que los que ya tenía esa alta (cierra el anterior).
- **Notificaciones a un teléfono ajeno**: pedir el código le manda una
  notificación a ese número antes de que nadie pruebe que es suyo, y cada
  pedido abre un socket desde la IP del servidor. Tres topes (429):
  `MAX_CODIGOS_POR_NUMERO_HORA` (5) por `claveDeTelefono`, así escribir el
  número de distintas formas no multiplica los intentos;
  `MAX_CODIGOS_POR_CUENTA` (5 cada 15 min) por cuenta o alta, así una sola
  no le puede mandar a un número distinto en cada pedido; y, en el alta,
  `MAX_CODIGOS_ALTA_POR_IP_HORA` (10, sólo producción). Un pedido a la vez
  por cuenta (409 si hay otro en curso).
- **Nunca sobre una sesión vinculada**: `pedirCodigo` mira
  `WhatsappSession.registered` en la base y no sólo el socket (que falta
  mientras reconecta o al arrancar): con una sesión vinculada contesta 409
  sin cerrar nada. En el alta, además, sólo mientras el usuario siga siendo
  un alta pendiente (`AltaWhatsappService.pedirCodigo`, 401 si no): una
  cookie de alta conservada no sirve sobre una cuenta ya creada.
- **No revela cuentas**: el endpoint no mira si el número tiene cuenta en
  Trato. Igual que con el QR, `asignarTelefono` lo resuelve recién al abrir
  la conexión (con `numero_en_uso` para una cuenta que no es un alta).
- **El código sólo vuelve a quien lo pidió** y no se loguea, ni el número:
  los warnings llevan el `userId` y el motivo.
- **Ingeniería social**: igual que con el QR, quien ingresa el código en un
  WhatsApp que ya tiene cuenta en Trato entra a esa cuenta
  (`transferirSesion`). La diferencia es que ahora a ese teléfono le llega
  una notificación de WhatsApp, que facilita el engaño "pasame el código que
  te llegó". El código se ingresa en el WhatsApp del dueño, no se dicta: la
  pantalla lo dice así.
- **Sesiones a medio vincular**: `estaVinculado` exige `creds.registered`
  mientras hay un código pendiente, así una sesión sin confirmar nunca queda
  `registered: true` ni se reanuda al arrancar; si se corta antes de que se
  ingrese el código, se borra la fila y no se reintenta.

## Conexión de WhatsApp: credenciales por clave y reconexión (2026-10-11, LAU-18)

- **Credenciales de Baileys**: ya no son un solo blob `{ creds, keys }`
  reescrito entero en cada mensaje. `creds` sigue cifrado en
  `WhatsappSession.authState`, y cada clave de Signal es una fila de
  `WhatsappClave`, cifrada **una por una** con AES-256-GCM y
  `TOKEN_ENCRYPTION_KEY` (`encryptToken`, IV aleatorio por valor). El id de
  cada clave tampoco queda en claro: los de `session` son el JID de cada
  cliente (su teléfono), que antes iba dentro del blob cifrado, así que la
  fila guarda `idDeFila`, un HMAC-SHA256 con una subclave derivada de esa
  clave (no se usa la misma clave directo para AES y para HMAC). Baileys
  siempre pide las claves por id, nunca las lista, así que se calcula de los
  dos lados. En claro queda sólo la categoría (`pre-key`, `session`…).
- **Borrado**: `WhatsappClave` cuelga de `WhatsappSession.userId` con
  `onDelete: Cascade`, así que desvincular, un código vencido, empezar de
  cero y `DELETE /auth/me` (usuario → sesión → claves) se llevan las claves
  sin código nuevo. `cuenta.db.spec.ts` lo cubre.
- **Migración**: una sesión anterior se parte en filas la primera vez que se
  carga, en una transacción que también saca `keys` del blob. Con
  `TOKEN_ENCRYPTION_KEY` rotada se arranca de cero y se borran las claves de
  ese usuario, como antes se descartaba el blob.
- **SQL crudo**: el upsert en lote (`unnest`) y la copia de
  `transferirSesion` usan `$executeRaw` con plantilla etiquetada, o sea
  parámetros y no texto concatenado.
- **En memoria**: `getMessage` guarda los últimos 200 mensajes **enviados**
  por cuenta (texto de las respuestas del asistente), para reenviarlos si el
  teléfono del cliente no los pudo descifrar. Lo que va al chat propio del
  dueño (códigos de acceso, avisos) no pasa por ahí: el código sólo vive
  hasheado. Se borran al cerrar la sesión
  o reiniciar la API; nunca van a logs ni a Sentry.
- **Avisos**: una sesión caída más de 10 minutos manda un warning a Sentry
  (`whatsapp-caido`, con userId, código de cierre e intentos, sin teléfonos)
  y un aviso a la campanita del dueño. Si WhatsApp rechaza la sesión
  (`forbidden`, `multideviceMismatch`, `badSession` repetido), la fila queda
  `registered: false`: el próximo arranque no reintenta esas credenciales y
  `/vincular` arranca de cero.

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
