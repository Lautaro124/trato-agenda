# Módulo de performance (LAU-30): definiciones

Qué mide el módulo de performance de las cuentas de ventas y con qué datos. Es la referencia para implementar y para los textos que explican cada métrica en pantalla. El foco es producto y resultado de las conversaciones, no adquisición ni campañas.

Hasta ahora lo único parecido es el histórico de `/ventas` (`api/src/comercio/historico.{rules,service}.ts`): totales, serie diaria y top 10 de productos por cobrado. No hay embudo, etapas, zona ni preguntas.

## Restricciones de los datos actuales

- `Message` se borra a los 90 días de inactividad del chat (`DIAS_RETENCION_MENSAJES`), y los datos del cliente de `Venta` se anonimizan a los 12 meses. Por eso toda métrica histórica sale de un agregado propio, sin datos personales, que no depende de los mensajes.
- Lo que se le mostró al cliente sólo existe como texto en el `content` de los mensajes `tool`. No hay ids estructurados, así que el interés por producto se registra aparte en el momento.
- La etapa de compra de Jev (`etapa-de-compra.ts`: `eligiendo` | `lista`) se calcula en cada turno y no se guarda en ningún lado.
- Una venta de stock no escribe `EventoVenta` al pagarse. El dato confiable del pago es `Venta.pagadaAt`.

## Base y período

- **Chat nuevo del período**: la base de todo. Es una conversación de una cuenta de ventas que escribió por primera vez dentro del período (`EtapaChat.createdAt`).
  - Sus pedidos y pagos cuentan aunque lleguen después.
  - Como la base no depende de los mensajes, que se borran a los 90 días, cualquier período se puede volver a calcular igual.
  - Un cliente que vuelve meses después sigue en el período en que escribió por primera vez.
  - Quedan fuera el banco de pruebas (`web-test:`) y las ventas `dePrueba`.
- **Período**: días de negocio en `TIMEZONE`, con las mismas reglas que el histórico (`rangoDeDias`, `diasEntre`; máximo 366 días). Para comparar, se toma el período anterior de igual largo.

## Conversión

Hay dos tasas separadas y una tasa final:

| Tasa | Numerador | Base |
| --- | --- | --- |
| Chat → pedido | chats que llegaron a la etapa *pedido* o más (hicieron un pedido o una solicitud a medida) | chats nuevos del período |
| Pedido → pago | pedidos de esos chats que llegaron a `estado = 'pagada'`, en la moneda elegida | pedidos de esos chats, en la moneda elegida |
| Chat → pago (final) | chats que llegaron a *pagado* | chats nuevos del período |

- **El evento de conversión es el pago.** Lo marca `VentasService.marcarPagada`, sea por el webhook o la conciliación de Mercado Pago o porque el dueño lo marcó a mano. El medio sale de `medioPago` / `mpPaymentId`.
- Cada tasa se muestra junto a su definición y su base.
- **"Sin datos" no es "0 %"**: una base de 0, o un período anterior al inicio de la recolección, se muestra como "sin datos". "0 %" es sólo para cuando hubo chats y ninguno convirtió.

## Etapas del chat

Las etapas se acumulan. Cada chat queda en la más avanzada que alcanzó:

1. **Consulta**: el cliente escribió.
2. **Vio productos**: hubo un `buscar_productos` o `ver_catalogo` con resultados, o se le mandó una foto (`enviar_imagen_producto`).
3. **Eligiendo / lista**: la etapa de Jev, guardada cada vez que se calcula. Sólo existe si la cuenta tiene Jev y pide datos del cliente. Si no hay dato se muestra "sin dato" y no se infiere.
4. **Pedido o solicitud**: se creó una `Venta`. En los productos a medida se agrega el subestado *cotizado* (hay presupuesto enviado).
5. **Pagado**.

**Estado de un chat que no llegó a pagado**, según su último mensaje (del cliente o del asistente):

| Estado | Sin mensajes hace |
| --- | --- |
| Activo | menos de 48 h |
| Estancado | entre 48 h y 7 días |
| Abandonado | más de 7 días |

- Un pedido que termina `vencida` o `cancelada` sin otro pago cuenta como abandono en la etapa *pedido*.
- Si el chat se derivó (`derivar_consulta`, o `atencion = 'humana'` en algún pedido), su etapa lleva la marca **derivado**. Así se ve dónde el asistente no pudo seguir.
- El módulo muestra la distribución de chats por etapa y estado y marca dónde se concentran los estancados y abandonados.

## Producto

- **Solicitado (interés)**: cada vez que un producto aparece en un resultado mostrado al cliente (búsqueda, catálogo, foto) se registra un evento `vio`. Cuando el cliente lo pide (`crear_pedido`, `pedir_variante`, `registrar_solicitud`) se registra un evento `pidio`. Se guarda el `productoId` en el nodo `catalogo`, en el mismo momento. Nunca se parsea texto.
- **Pagado**: unidades y cobrado salen de `ItemVenta` de las ventas pagadas, igual que el `topProductos` actual. Los a medida se cuentan por `solicitud.productoId`.
- **Por producto se muestra**:
  - chats que lo vieron;
  - chats que lo pidieron;
  - chats que lo pagaron;
  - las conversiones entre esos tres;
  - unidades y cobrado;
  - la etapa donde más se cortan sus chats.

  Hay rankings de más solicitados y más pagados, y todo se puede cruzar con la zona.

## Zona

Se guarda sólo la **provincia** y de dónde salió. Nunca el número ni la dirección.

| Origen | Cuándo | Se muestra como |
| --- | --- | --- |
| `dato` | El cliente la dio en `datosCliente`: campo `provincia`, o derivada de un código postal argentino | hecho |
| `inferida` | No la dio. Se toma la característica de un móvil argentino (`54 9 <característica> …`), con una tabla pura característica → provincia | inferencia |
| `sin_zona` | No hay ninguna de las dos (por ejemplo, un número de otro país) | — |

La característica es la zona de la línea, no necesariamente la del cliente. Por eso la pantalla distingue `inferida` de `dato`.

- La provincia es un **dato personal** mientras la fila esté atada a una conversación, porque la conversación tiene el teléfono. Se declara en `/privacidad` y en [seguridad.md](seguridad.md).
- La tabla característica → provincia es pura y local: el número nunca sale a un servicio externo y nunca aparece en logs ni en Sentry.

## Preguntas de los clientes

- Cada chat se clasifica **una sola vez**, con un único llamado a OpenRouter, la primera vez que pasa a estancado, abandonado o pagado. Es idempotente: antes del llamado se reserva la marca `clasificadaAt` en `EtapaChat` de forma atómica (`updateMany … where clasificadaAt is null`, y sólo sigue quien actualizó una fila), así que un chat que pasa por varios estados no se manda dos veces. Un chat que vuelve a escribir después de clasificado no se reclasifica.
- El llamado lleva `POLITICA_DE_PROVEEDOR` y usa un modelo con endpoint ZDR (ver [modelo-y-zdr.md](modelo-y-zdr.md)). Si falla, se registra con `resumenDeError`. Si falla no se reintenta en loop, y el chat queda sin clasificar.
- **Qué se manda al modelo**: sólo los mensajes de texto del chat dentro de la ventana de historial. No se mandan el teléfono, el nombre del cliente, `datosCliente` ni los resúmenes. Antes de mandarlos se les aplica el mismo saneado que antes de guardar (ver abajo).
- El texto del cliente se trata como dato (`JSON.stringify`), igual que en el resto de los prompts.
- La salida del modelo es un **reclamo a validar en código**, no una orden:
  - un tema fuera del catálogo pasa a `otro`;
  - un `productoId` que no está entre los `InteresProducto` de ese chat se descarta;
  - una etapa que no existe se descarta.
- Por cada pregunta se guarda:
  - el texto, sólo después de un **saneado determinista en código**: se quitan emails, teléfonos y cualquier secuencia de 7 o más dígitos, URLs y direcciones (calle + número), y se trunca a 200 caracteres. El truncado va antes de las regex, y las regex no usan backtracking anidado. El saneado es de mejor esfuerzo: no detecta nombres propios. Si después del saneado no queda una pregunta legible, se guarda sólo el tema;
  - un **tema** de un catálogo fijo: precio, envío, stock / variantes, medidas / materiales, pago, plazos, local, otro;
  - el `productoId`, sólo si era un producto mostrado en ese chat;
  - la **etapa** en la que apareció;
  - si quedó **resuelta**: respondida con datos de una tool, o derivada / sin respuesta.
- En pantalla, las preguntas se agrupan por producto y por tema, con las más frecuentes y las sin resolver primero, y se relacionan con la etapa donde se cortó el chat.
- La clasificación es una inferencia y se marca como tal.

## Tips de ventas

- Los tips se generan con **reglas en código** sobre los agregados, no con el modelo. Ejemplos:
  - "Producto X: el 40 % de las preguntas son de envío y el 60 % de sus chats se corta en *vio productos*".
  - "En Córdoba (inferida) la conversión es la mitad del promedio".
- Cada tip muestra la observación que lo motiva y separa los **hechos** (conteos) de las **inferencias** (zona inferida, clasificación de preguntas).
- Sólo se emite un tip con un mínimo de chats en el segmento (10 de partida), para no sacar conclusiones de dos casos.

## Persistencia y retención

Habrá tablas nuevas. Cada una tiene su propio `userId` con `onDelete: Cascade`, así que el borrado de cuenta no depende de `Conversation`. Todas las consultas del módulo filtran por el `userId` de la sesión.

- `EtapaChat`: una fila por conversación con la etapa máxima, la última etapa de Jev, el estado, la provincia y su origen, la marca de derivado y los timestamps.
- `InteresProducto`: conversación, `productoId`, tipo (`vio` | `pidio`) y fecha.
- `PreguntaChat`: conversación, texto normalizado, tema, `productoId`, etapa, resuelta.

En las tres, `conversationId` es `SetNull`. Así los agregados sobreviven a la purga de mensajes de 90 días y a la de conversaciones inactivas.

**Retención**:

| Dato | Se borra o anonimiza | Mismo plazo que |
| --- | --- | --- |
| Texto saneado de `PreguntaChat` | a los 90 días | `Message` |
| Tema, etapa, producto y resuelta | se conservan | — |
| `conversationId` en las tres tablas | se pone en null a los 12 meses | los datos del cliente en `Venta` |
| Provincia | se conserva, pero desligada de la conversación desde ese momento | — |

- El texto de las preguntas no sobrevive al chat del que salió: se borra a los 90 días o cuando se purga su conversación, lo que pase primero.
- Desde los 12 meses, todo lo que queda son conteos por cuenta, sin forma de volver al cliente.
- Estos plazos van en `retention.rules.ts`, `/privacidad` y [verificacion-google.md](verificacion-google.md), en el mismo cambio que los implemente.

Las métricas empiezan el día del deploy, sin backfill desde `Message`. Los períodos anteriores se muestran como "sin datos".

## Estado de la implementación

**Registro (hecho).** Tablas `EtapaChat` e `InteresProducto` (migración `20261021140000_performance_registro`) y `RegistroPerformanceService` (`api/src/performance/`). Todo el registro es de mejor esfuerzo: un error queda en el log con ids y no frena la venta ni la respuesta. Se ignoran el banco de pruebas, las ventas `dePrueba` y las conversaciones o productos de otra cuenta.

Dónde se escribe:

| Qué | Dónde |
| --- | --- |
| Actividad y etapa de Jev | `cargar-contexto-ventas.node.ts`, en cada ráfaga del cliente |
| `vio` | `catalogo.node.ts`: `buscar_productos`, `ver_catalogo` (listado), `enviar_imagen_producto` |
| `pidio` | `catalogo.node.ts`: `crear_pedido` (por variante), `pedir_variante`, `registrar_solicitud` |
| `cotizado` | `PedidosAMedidaService.enviarPresupuesto` |
| `pagado` | `VentasService.marcarPagada` (webhook, conciliación y cobro manual) |
| Derivado | `derivar_consulta` en el nodo y `PedidosAMedidaService.derivar` |

La retención desliga la conversación a los 12 meses (`RetentionService.desligarPerformance`).

Columnas que existen pero todavía nadie escribe: `provincia` y `origenZona` (paso de zona) y `clasificadaAt` (paso de preguntas).

**Lectura (hecho).**

`GET /performance?desde&hasta&moneda` (`api/src/performance/lectura.service.ts`, reglas puras en `lectura.rules.ts`):
- Es sólo para cuentas de ventas; una cuenta de agenda recibe 409. Todo se filtra por cuenta.
- Sin fechas, toma los últimos 30 días, como el histórico.

Qué devuelve:
- **`datos`**: `completos`, `parciales` o `sin_datos`, según el primer chat registrado de la cuenta (`registroDesde`).
- **`definiciones`**: los textos que se muestran tal cual al lado de cada métrica.
- **`conversion`**: conteos y tasas. Una tasa con `valor: null` significa "sin datos" y no es 0 %. Incluye `anterior`, el período anterior de igual largo, o `null` si ese período no tiene datos.
- **`etapas`**: cada etapa con su total, cuántos chats están activos, estancados o abandonados, y cuántos se derivaron.
- **`productos`** (hasta 50, los de más interés primero):
  - cuántos chats lo vieron, lo pidieron y lo pagaron, y las tasas entre esos pasos;
  - unidades y monto cobrado;
  - `cortanEn`: la etapa donde más se quedan los chats que lo vieron y no pagaron.

Cómo se cuentan los productos:
- Los de stock salen de los renglones del pedido, por variante. Los a medida salen de `solicitud.productoId`.
- A partir de los 12 meses, el interés se cuenta por su propia fecha. En cambio, los pagos sólo se atribuyen a un producto mientras el chat no se haya desligado.

**Pantalla (hecho).**

`/rendimiento` (`web/src/app/rendimiento/page.tsx`, componentes en `web/src/components/rendimiento/`, tipos copiados a mano en `web/src/lib/performance.ts`) es sólo para cuentas de ventas. En escritorio es la pestaña "Rendimiento"; en el celular se llega desde el menú de usuario.

Arriba se elige el período (hoy, 7 o 30 días, este mes o fechas) y la moneda. Un período que llega hasta hoy está **en vivo**: se vuelve a pedir cada 30 segundos y al volver a la pestaña, sólo con la pestaña a la vista, y muestra la hora de la última actualización. Un refresco que falla deja los datos anteriores. Después muestra:
- un aviso cuando el período tiene datos a medias o ninguno;
- las tres tasas, cada una con su definición y su diferencia con el período anterior;
- el embudo, en cantidades;
- dónde están los chats, con la etapa en la que más se quedan;
- la tabla de productos, que se puede ordenar por más vistos, más pedidos o más pagados.

**Zona (hecho).**

Reglas puras en `api/src/performance/zona.rules.ts`; los nombres de las zonas están copiados a mano en `web/src/lib/performance.ts`. De dónde sale la zona:
- **Inferida:** sale de la característica de un celular argentino.
  - Se calcula en `tocarChat` y sólo si el chat todavía no tiene zona.
  - La tabla cubre las características principales; una que no está queda sin zona.
  - La característica 11 es "CABA o Gran Buenos Aires", porque no distingue la Ciudad del conurbano.
- **Dato:** sale de `registrarZonaDeDatos`, que el nodo `catalogo` llama después de `crear_pedido`, `pedir_variante` y `aceptar_presupuesto` con los datos guardados del pedido.
  - Se toma el campo provincia o, si no está, la letra del código postal. Un código de 4 números sólo se lee en la Ciudad (1000–1499).
  - Le gana a la inferida.
  - Si el país no es Argentina, no se guarda provincia.

Cómo se lee:
- `GET /performance?zona=<clave>|sin_zona` acota la conversión, las etapas y los productos a esa zona: así se cruza producto con zona.
- Con el filtro de zona, los intereses ya desligados de su chat quedan afuera, porque no se sabe de qué zona son.
- `zonas` trae siempre todas las zonas, con cuántas son inferidas, para poder compararlas.
- La pantalla tiene el selector de zona y la sección "Por zona", con el botón "Ver sólo esta".

Los chats anteriores a este cambio sólo tienen zona si vuelven a escribir.

**Preguntas (hecho).**

Cómo se clasifican (`api/src/performance/preguntas.rules.ts` y `preguntas.service.ts`):
- Cada 10 minutos, un barrido toma hasta 20 chats que nunca se clasificaron.
- Entran los que quedaron quietos 48 horas o los que pagaron.
- Cada chat se clasifica una sola vez: un llamado al modelo, sin reintento.
- Sin `OPENROUTER_API_KEY`, no hace nada.

Ajuste a la definición: la "etapa" de una pregunta es **la etapa en la que quedó el chat** cuando se clasificó, no la del mensaje. No se guarda la etapa por mensaje, y para "qué preguntan donde se quedan" es el dato que sirve.

`GET /performance` suma `preguntas`, filtrado por cohorte y zona:
- cuántos chats ya se analizaron, sobre el total;
- `porTema`, con total, sin resolver y hasta 3 ejemplos;
- `porProducto`;
- `dondeSeQuedan`: por etapa y tema, sólo de los chats que no pagaron.

La pantalla muestra todo eso en la sección "Qué preguntan".

El stub de E2E reconoce el pedido por `MARCA_CLASIFICACION` y contesta un JSON fijo.

**Pendiente:**
- tips.
