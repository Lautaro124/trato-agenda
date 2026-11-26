# Canal de WhatsApp por comercio (LAU-110)

WhatsApp quedó separado en dos capas:

- **Proveedor** (`api/src/whatsapp/proveedor/proveedor.ts`): transporte. Baileys, en
  `api/src/whatsapp/baileys/baileys.proveedor.ts`, y la API oficial (Cloud API), en
  `api/src/whatsapp/cloud/` (ver abajo). Se encarga de los sockets, las credenciales
  cifradas, la vinculación por QR o código con SSE, la reconexión y la descarga de medios con
  validación de host. También traduce lo que llega a `EntranteCanal` y expone una `SesionCanal` por conexión.
- **Atención** (`WhatsappService`, que implementa `ReceptorCanal`): atención humana, pausa,
  suscripción, horario (LAU-29/37), audios, imágenes, ráfagas por chat y el ritmo de las respuestas.
  No importa Baileys.

Su API pública no cambió, así que los consumidores (`chats`, `notificaciones`, `auth`, `retention`) no
se tocaron.

## Estado del canal (`CanalWhatsapp`)

Una fila por comercio con `proveedor`, `automatizacionPausada`, `generacion` y `ultimoFallo`.
**Si la cuenta no tiene fila, usa Baileys y no está en pausa**: las cuentas de antes no migran datos ni
hacen nada. `CanalesWhatsapp` lo cachea en memoria y la caché manda mientras dura el proceso, porque
todo cambio pasa por ese servicio y la API corre con una sola réplica.

- **Un único emisor**: cada mensaje en espera lleva la generación con la que llegó. Pausar, reanudar o
  cambiar de proveedor sube la generación. Antes de cada envío automático se compara con la vigente;
  si cambió, no sale. Lo que llega por un proveedor que no es el del comercio se ignora entero.
- **Pendientes en el corte**: lo que esperaba su ráfaga, o se estaba armando y se canceló, se guarda en
  el historial como en atención humana (sólo si el chat ya existe) y no sale por ningún proveedor.
  Una respuesta ya comprometida deja de salir en el envío siguiente: lo que mandó queda en el
  historial.
- **Pausa** (`POST /whatsapp/automatizacion { pausada }`): es la contingencia de atención manual. No
  contesta el asistente, ni sale el aviso de pago, ni se contestan pendientes al devolver un chat.
  La vinculación, Chats y los mensajes desde el panel siguen andando. Lo que llega se guarda para el
  dueño, igual que en atención humana: un chat que todavía no existía lo ve sólo en el teléfono.
- **Cambio de proveedor**: por ahora sólo interno (`WhatsappService.cambiarProveedor`). No vincula ni
  desvincula nada. El historial, el usuario y la configuración viven en `Conversation`, `User` y `Agent`,
  así que no se tocan.
- **Fallos visibles**: `volver_a_vincular` cuando WhatsApp deja de aceptar la sesión, `sin_conexion`
  tras una caída larga, y nada cuando se recupera. `/whatsapp/status` los devuelve junto con
  `proveedor` y `automatizacionPausada`. Se guarda un código, nunca el mensaje del proveedor.
- **Duplicados**: `MensajeRecibido` sigue con `(userId, waId)`. Los ids de Baileys van tal cual y los
  de otro proveedor con su nombre adelante (`claveDeMensaje`).

## Identificadores (`proveedor/contacto.ts`)

Un proveedor oficial identifica al cliente por su número (`wa_id`). `resolverChat` lo asocia a la
conversación que ya existe en ese comercio, y sólo por equivalencias de WhatsApp: el 9 de Argentina y el
1 de los móviles viejos de México. Compara contra el JID o contra el `telefono` que WhatsApp dio aparte
en un chat LID. No saca el 0 ni el 15, y si hay más de una coincidencia devuelve `ambiguo` en vez
de elegir una. Hoy no lo usa nadie: queda listo para el proveedor oficial.

## Sumar un proveedor

1. Agregar su id a `PROVEEDORES_WHATSAPP`.
2. Implementar `ProveedorWhatsapp` y `SesionCanal`. `MediaEntrante.descargar` tiene que validar el
   host y aplicar los topes.
3. Registrarlo en `WhatsappService` (mapa `proveedores`) y en `WhatsappModule`.
4. Resolver el chat con `resolverChat`, y no crear conversaciones por su cuenta.

Las reglas de Baileys de `CLAUDE.md` (navegador, `markOnlineOnConnect`, historial, claves cifradas,
códigos pendientes, `creds.me`) siguen dentro de `BaileysProveedor`.

## API oficial (Cloud API con Embedded Signup)

Se activa con las variables `META_*` (ver README). Sin ellas `/whatsapp/cloud/config` devuelve
`disponible: false` y `/vincular/oficial` avisa que todavía no está disponible.

**Quién usa cada proveedor.** `User.vinculaConBaileys` marca las cuentas de antes de la API oficial
que ya usaban WhatsApp (tenían número o sesión de Baileys al migrar): sólo esas vinculan por QR o
código, y `/vincular` es eso. Las demás van a `/vincular/oficial`, y `WhatsappService` les rechaza
`link/start` y `link/codigo` con 403 (`motivo: 'solo_api_oficial'`). Las cuentas nuevas se crean con
Google: `POST /auth/whatsapp/alta` (crear la cuenta escaneando el QR) devuelve 410 y
`/entrar/whatsapp` redirige a `/entrar`. El resto de `alta/*` y `AltaWhatsappService` quedan sin
uso, para borrar.

- **Alta** (`/vincular/oficial`): la web carga el SDK de Meta y abre Embedded Signup con el `config_id`.
  Con Coexistence manda `featureType: 'whatsapp_business_app_onboarding'`. Junta el código del
  callback de `FB.login` y la WABA y el número del evento `WA_EMBEDDED_SIGNUP` (sólo de orígenes
  `*.facebook.com`), y los manda a `POST /whatsapp/cloud/alta`.
- **En la API** (`CloudProveedor.conectar`): se canjea el código (por POST, con el secreto de la app)
  por el token de negocio y se comprueba que el número esté en la WABA que ve ese token: nada de lo
  que manda el navegador se cree. El número no puede ser de otra cuenta de Trato. Sin Coexistence se
  registra con el PIN de la verificación en dos pasos, que no se guarda. Después se suscribe la app a la
  WABA y se guarda `CuentaWhatsappCloud` con el token cifrado. `WhatsappService.conectarCloud` pasa el
  canal a `cloud` y cierra la sesión de Baileys: un solo emisor.
- **Webhook** (`/whatsapp/cloud/webhook`, sin sesión): el GET contesta el challenge si el token de
  verificación coincide; el POST llega crudo (`main.ts`) y se verifica `X-Hub-Signature-256` con el
  secreto de la app antes de parsear. Responde enseguida y atiende después; los duplicados los frena
  `MensajeRecibido` (`cloud:<id>`). Cada cliente se asocia al chat existente con `resolverChat`.
  - `messages`: texto, botones, audios e imágenes (se bajan de los hosts de Meta con el token y con
    los mismos topes) y el anuncio de clic a WhatsApp.
  - `smb_message_echoes`: lo que el dueño escribe desde la app con Coexistence; pasa el chat a
    atención humana igual que con Baileys.
  - `account_update` con `PARTNER_REMOVED`: se borra la cuenta y queda `volver_a_vincular`.
- **Envío**: texto y fotos (se suben como media) al `wa_id` del chat; un chat LID de Baileys usa el
  `telefono` guardado. "Escribiendo…" y leído van con `status: read` sobre el último mensaje del
  cliente. Un token rechazado (código 190) deja `volver_a_vincular`.
- **Desconectar** (`/whatsapp/unlink`): da de baja el webhook de la WABA y borra el token. El número
  sigue en Meta. Para volver a QR, `/vincular` pasa el canal a Baileys si la oficial ya no está
  conectada; con la oficial conectada, lo rechaza.

### Límites

- La Cloud API no puede escribirle al propio número: el código de acceso por WhatsApp no sale para
  esas cuentas (la recuperación por email es LAU-109).
- Fuera de la ventana de 24 h desde el último mensaje del cliente, Meta rechaza los mensajes libres
  (el aviso de pago aprobado incluido): hacen falta plantillas, que no están implementadas.
- No se importa el historial ni los contactos de Coexistence, y no se informa la duración de los
  audios (los topes los aplica la descarga).
- Antes de onboardear comercios reales hacen falta App Review (acceso avanzado a
  `whatsapp_business_management` y `whatsapp_business_messaging`) y la adecuación de textos de LAU-104.
