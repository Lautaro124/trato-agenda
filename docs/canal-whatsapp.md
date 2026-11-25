# Canal de WhatsApp por comercio (LAU-110)

WhatsApp quedó separado en dos capas:

- **Proveedor** (`api/src/whatsapp/proveedor/proveedor.ts`): transporte. Hoy el único es Baileys,
  en `api/src/whatsapp/baileys/baileys.proveedor.ts`. Se encarga de los sockets, las credenciales
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
