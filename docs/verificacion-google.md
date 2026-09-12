# Verificación OAuth de Google

Estado y material para (re)enviar la app **Trato Agenda** (proyecto Cloud
`turnerowebtrato`) a la verificación de Google.

Google rechazó el primer envío por tres cosas: la política de privacidad no
describía las medidas de protección de datos sensibles, la app parecía integrar
IA/ML con datos de Google Workspace, y faltaba la declaración explícita de
Limited Use con el detalle de proveedores de IA. Este documento junta los hechos
verificados en el código, lo que se cambió para responder, y lo que queda por
hacer a mano.

## Hechos verificados en el código

Nada de acá es una afirmación de marketing: cada punto tiene su archivo.

### Scopes que pide la app

`api/src/auth/google.strategy.ts` — `GOOGLE_SCOPES`:

| Scope | Para qué |
| ----- | -------- |
| `openid`, `profile`, `email` | Crear la cuenta, reconocer al usuario, mostrar nombre y avatar. |
| `https://www.googleapis.com/auth/calendar.events` | `events.insert`, `events.patch`, `events.delete`, `events.list` sobre el calendario `primary`. |
| `https://www.googleapis.com/auth/calendar.freebusy` | `freebusy.query`, la única lectura del calendario en el flujo con clientes. |

El envío anterior pedía `https://www.googleapis.com/auth/calendar` completo
(lectura y escritura de todos los calendarios, ACLs y settings). Se recortó para
este reenvío.

`calendar.app.created` **no** alcanza como alternativa: la disponibilidad tiene
que contar también los eventos que el titular cargó a mano, y ese scope sólo deja
ver los que creó la app.

### Llamadas a la API de Google y campos que se leen

Todas contra `calendarId: 'primary'`, en `api/src/calendar/calendar.service.ts`:

| Método | Qué se lee de la respuesta |
| ------ | -------------------------- |
| `freebusy.query` | Sólo `busy[].start` y `busy[].end`. |
| `events.insert` | Sólo `id`. |
| `events.patch` | Nada. |
| `events.delete` | Nada. |
| `events.list` | `id`, `summary`, `start.dateTime`, `end.dateTime`. |

`description`, `attendees`, `location`, `organizer` y `creator` **no se leen en
ninguna parte del código**. No se llama a `calendarList`, `acl`, `settings`,
`oauth2.userinfo` ni a ninguna otra API de Google (nada de Gmail, Drive o
People).

### Qué llega al modelo de lenguaje

- En el flujo con clientes de WhatsApp, **ningún contenido de eventos de Google
  llega al modelo**. La única lectura es `freebusy.query`, que se reduce a
  `{inicio, fin}` (`calendar.service.ts`) y después se invierte a **huecos
  libres** en `api/src/conversation/graph/agenda-rules.ts`
  (`resumirDisponibilidad`). Al prompt entran líneas como
  `lunes 8/9: 09:00-12:05, 13:30-18:00`.
- El email, el nombre y la foto de Google del titular **nunca** llegan a un
  prompt. El registro de usuario se carga sólo para autenticarse contra Google.
- Única excepción, declarada: la herramienta `listar_eventos_calendario`
  (`api/src/conversation/graph/nodes/calendar.node.ts`) devuelve al modelo el
  `id`, el `summary` y el horario de los eventos del propio titular. Se ofrece
  sólo cuando `esPropietario` (`conversacion.node.ts`, revalidado en
  `validacion.node.ts`), que sale de un JID `web-test:<userId>` acuñado
  únicamente desde la sesión autenticada (`conversation.service.ts`,
  `conversation.controller.ts`). Un cliente de WhatsApp no puede alcanzarla.
- No hay entrenamiento, ni fine-tuning, ni export de datasets, ni
  almacenamiento de prompts con ese fin. Los evals (`api/evals/`) corren sobre
  fixtures y un calendario falso en memoria, nunca sobre datos reales.
- No hay telemetría de terceros: ni Sentry, ni PostHog, ni LangSmith (LangChain
  no manda trazas a ningún lado).

### Configuración de no entrenamiento / no retención

`POLITICA_DE_PROVEEDOR` en `api/src/agents/openrouter.client.ts`, importada
también por `api/src/conversation/llm.provider.ts`, viaja en **toda** llamada:

```json
{ "provider": { "data_collection": "deny", "zdr": true } }
```

`data_collection: "deny"` rutea sólo a proveedores que no guardan los datos de
forma no transitoria ni entrenan con ellos; `zdr: true` restringe el ruteo a
endpoints con política de Zero Data Retention. Lo mismo está activado a nivel de
cuenta en las privacy settings de OpenRouter (el flag por request opera como OR
con la config de cuenta).

### Protección de datos

- Refresh token de Google cifrado con **AES-256-GCM**, IV aleatorio por registro
  y authTag (`api/src/auth/token-crypto.ts`). Clave de 256 bits en
  `TOKEN_ENCRYPTION_KEY`, validada al arrancar; la API no bootea sin ella.
- El token nunca sale del backend: `UsuarioPublico`
  (`api/src/auth/auth.types.ts`) es la única forma de usuario que ve el front, y
  el token no se serializa en los checkpoints del grafo
  (`api/src/conversation/graph/state.ts`).
- Las credenciales de la sesión de WhatsApp usan el mismo cifrado.
- Sesión en cookie `httpOnly` + `secure`, JWT con payload mínimo
  (`{ sub, email }`), 7 días de vida.
- CORS restringido a un único origen y chequeo de `Origin` contra CSRF
  (`api/src/auth/csrf-origin.ts`).
- Webhook de pagos verificado por HMAC antes de tocar nada.
- Los logs no incluyen el texto de los mensajes, el contenido de eventos, ni
  credenciales; tampoco el email de Google.

### Borrado y retención

- `DELETE /auth/me` (`api/src/auth/cuenta.service.ts`): revoca el token en
  `https://oauth2.googleapis.com/revoke`, cancela el cobro en Mercado Pago si
  hay uno activo, cierra la sesión de WhatsApp, borra los threads del
  checkpointer de LangGraph —que están fuera del cascade de Prisma— y borra el
  usuario con todo lo que cuelga de él. Autoservicio desde `/cuenta` en la app.
- Retención (`api/src/retention/retention.rules.ts`): mensajes y estado de
  conversación a los **90 días** de inactividad; nombre y resumen del cliente a
  los **12 meses**; los turnos mientras exista la cuenta. Lo aplica una purga
  diaria idempotente (`retention.service.ts`).
- Los eventos ya creados en el calendario del titular **no** se borran: son
  suyos. Está dicho así en `/privacidad`.

## Borrador de respuesta a Google

Para pegar en la respuesta al mail de verificación. Revisar el nombre del modelo
antes de mandarlo.

> **What the app does**
>
> Trato Agenda is a WhatsApp assistant that books appointments into the account
> owner's own Google Calendar. The owner signs in with Google, links their
> WhatsApp number, and from then on the assistant answers their clients'
> messages, proposes free slots, and creates, moves or cancels the corresponding
> calendar events.
>
> **Scopes requested and why each one is needed**
>
> - `openid`, `email`, `profile` — account creation and identification, and
>   showing the signed-in user their own name and avatar.
> - `https://www.googleapis.com/auth/calendar.events` — create, move, cancel and
>   list the appointments the assistant agrees with the owner's clients.
>   `calendar.app.created` is insufficient because availability must also account
>   for events the owner created by hand, which that scope does not expose.
> - `https://www.googleapis.com/auth/calendar.freebusy` — read busy/free
>   intervals to compute availability.
>
> For this resubmission we **narrowed** the request: the previous submission
> asked for `https://www.googleapis.com/auth/calendar`, and we removed it.
>
> **Exactly what Calendar data we read**
>
> Only `busy[].start` and `busy[].end` from `freebusy.query`, and `id`,
> `summary`, `start` and `end` from `events.list`. We never read event
> descriptions, attendees, attendee emails, locations, organizers or creators —
> there is no code path that does.
>
> **AI/ML disclosure**
>
> - Provider: OpenRouter, endpoint `https://openrouter.ai/api/v1/chat/completions`,
>   pay-as-you-go API. No fine-tuning product is used.
> - Model: `<MODELO>`, served through OpenRouter.
> - We do **not** use any Google user data to create, train, fine-tune or improve
>   any AI/ML model, and we do **not** transfer raw, aggregated, anonymised or
>   derived Google user data to any third party for model training.
> - Non-training / retention configuration: every request sets
>   `provider.data_collection: "deny"` and `provider.zdr: true`, which restricts
>   routing to providers that do not retain prompts and therefore cannot train on
>   them (Zero Data Retention). The same restriction is enforced account-wide in
>   our OpenRouter privacy settings. Screenshot attached.
> - What is sent to the model: the business configuration the owner typed during
>   onboarding, derived free-slot time ranges (times only, no event content), and
>   the WhatsApp conversation with the client. Google Calendar event titles are
>   sent only when the owner themselves opens their own dashboard to review their
>   own calendar; that path is unreachable for WhatsApp end users.
> - No self-hosted or offline model is used.
>
> **Data protection**
>
> The Google refresh token is stored encrypted with AES-256-GCM (random IV per
> record, authentication tag), the key held in a server-side environment variable
> and never in source control. The token never leaves our backend: it is not
> exposed to the browser, not returned by any API response, and not serialised
> into conversation state. All traffic is TLS. The session is an `httpOnly`,
> `secure` cookie holding a signed token with only a user id and email. CORS is
> restricted to a single origin and every state-changing request is rejected
> unless it originates there. Logs contain no message content, no event content
> and no credentials.
>
> **Retention and deletion**
>
> Users can delete their account and all their data themselves, from the Account
> screen in the app. Deletion revokes our access at
> `https://oauth2.googleapis.com/revoke`, cancels any active billing, and removes
> the user, their assistant, conversations, messages, appointments and internal
> conversation state immediately. Message content is deleted after 90 days of
> conversation inactivity regardless; client names and summaries after 12 months.
>
> **Limited Use**
>
> Trato Agenda's use of information received from Google APIs will adhere to the
> Google API Services User Data Policy, including the Limited Use requirements.
> The use of raw or derived user data received from Workspace APIs will adhere to
> the Google User Data Policy, including the Limited Use requirements.
>
> **Links**
>
> - Homepage: https://tratoagenda.com
> - Privacy policy: https://tratoagenda.com/privacidad
> - Terms of service: https://tratoagenda.com/terminos
> - Demo video: `<URL>`

## Guion del video demo

Sin cortes, con la URL visible en la barra del navegador todo el tiempo.

1. Homepage en `tratoagenda.com`; scrollear al footer y mostrar los enlaces a
   Privacidad y Términos.
2. Abrir `/privacidad` y recorrer despacio las secciones **Uso de inteligencia
   artificial**, **Cómo protegemos tus datos** y **Cumplimiento de la política de
   datos de Google** (que se lea en pantalla la frase en inglés).
3. `/entrar` → mostrar que ahí también están los enlaces legales → "Continuar con
   Google" → **la pantalla de consentimiento completa, con los scopes a la
   vista** → aceptar.
4. `/contanos`: completar el alta de cinco pasos. Deja claro que la config del
   asistente la tipea el usuario y no sale de datos de Google.
5. `/vincular`: escanear el QR con un teléfono.
6. Desde otro teléfono, escribirle al asistente y pedir un turno: que ofrezca
   horarios y confirme.
7. Abrir el Google Calendar del titular en otra pestaña y mostrar el evento
   creado — uso de `calendar.events`.
8. Pedir por WhatsApp que lo mueva y mostrar el evento movido; pedir que lo
   cancele y mostrar que desapareció.
9. `/calendario` en la app, listando los eventos del titular — el otro uso de
   `calendar.events`.
10. `/cuenta` → escribir `ELIMINAR` → **Eliminar mi cuenta y mis datos**. Después
    abrir `https://myaccount.google.com/permissions` y mostrar que Trato Agenda
    **ya no figura**. Es la prueba en video de que la revocación funciona, y es
    lo que más peso tiene.

## Lo que falta hacer a mano

- [ ] **Opcional, pero mejora la impresión: casilla en el dominio.** El
      contacto publicado en `/privacidad`, `/terminos`, la landing y `/cuenta`
      es hoy un Gmail personal (`EMAIL_SOPORTE` en `web/src/lib/contacto.ts`).
      Funciona y se lee, que es lo que importa; un `soporte@tratoagenda.com`
      queda mejor ante quien revisa, y para cambiarlo alcanza con esa constante.
      Lo que **no** hay que hacer es publicar una dirección que todavía no
      recibe mail.
- [ ] **Verificar `tratoagenda.com` en Search Console**, con la misma cuenta de
      Google dueña del proyecto Cloud.
- [ ] **Consola de Google**: pasar la pantalla de consentimiento de *Testing* a
      *In production*; completar App domain, homepage, Privacy policy URL y Terms
      of service URL con las URLs de arriba; dejar en la lista de scopes sólo los
      cinco de este documento, con su justificación; confirmar el redirect URI
      `https://api.tratoagenda.com/auth/google/callback` y el JavaScript origin
      `https://tratoagenda.com`.
- [ ] **Privacy settings de OpenRouter**: activar el filtro de proveedores que
      almacenan inputs para entrenamiento y el enforcement de ZDR, y guardar la
      captura para adjuntarla.
- [x] ~~**`npm run eval`** para confirmar que el modelo sigue ruteando con la
      política de proveedor.~~ Corrido el 12/09/2026: **ningún modelo perdió el
      ruteo**, ZDR no rompe nada y se puede deployar. Apareció otra cosa, que no
      bloquea la verificación pero sí afecta la experiencia: el modelo actual
      quedó el doble de lento. Los datos y las opciones están en
      [`modelo-y-zdr.md`](modelo-y-zdr.md) — **decisión pendiente**. Poner el
      modelo que se elija en el borrador de respuesta de arriba, donde dice
      `<MODELO>`.
- [ ] **Probar los scopes recortados de punta a punta** (ver abajo).
- [ ] **Grabar y subir el video** como *unlisted* en YouTube.
- [ ] **Verificar que el nombre del responsable coincida con la consola.** La
      política y los términos declaran a **Raúl Gonzalez, CUIT 20-22390119-1**
      como responsable del tratamiento (`web/src/lib/contacto.ts`). El *developer
      contact* y el titular del proyecto Cloud tienen que ser la misma persona,
      o Google pregunta.

## Cómo probar el recorte de scopes

Los scopes nuevos hay que ejercitarlos contra Google de verdad, porque la
documentación no lista de forma concluyente qué scope autoriza `freebusy.query`:
puede que `calendar.events` ya lo cubra y `calendar.freebusy` sea redundante, o
que sea al revés.

1. Revocar el acceso de Trato Agenda en
   `https://myaccount.google.com/permissions`.
2. Entrar de nuevo (el consentimiento tiene que mostrar los scopes nuevos).
3. Ejercitar las cinco llamadas: pedir disponibilidad desde el chat de prueba
   (`freebusy.query`), agendar (`events.insert`), reprogramar (`events.patch`),
   cancelar (`events.delete`) y abrir `/calendario` (`events.list`).
4. Cualquier `403` con `insufficient permissions` identifica el scope que falta.
   El código ya lo distingue: se traduce a `GoogleReconsentimientoError`
   (`api/src/calendar/google-calendar.client.ts`) en lugar de a un 502 genérico,
   así que el síntoma es "hay que volver a entrar con Google" y no un error
   opaco.

Ojo con las cuentas ya existentes: el refresh token viejo sigue valiendo para los
scopes viejos, así que **todo usuario que consintió antes tiene que volver a
entrar**. Al momento de este cambio había un único usuario de prueba, así que no
hubo que avisar a nadie.
