# Módulo de performance (LAU-30): definiciones

Qué mide el módulo de performance de las cuentas de ventas y con qué datos. Es la referencia para implementar y para los textos que explican cada métrica en pantalla. El foco es producto y resultado de las conversaciones, no adquisición ni campañas.

Hasta ahora lo único parecido es el histórico de `/ventas` (`api/src/comercio/historico.{rules,service}.ts`): totales, serie diaria y top 10 de productos por cobrado. No hay embudo, etapas, zona ni preguntas.

## Restricciones de los datos actuales

- `Message` se borra a los 90 días de inactividad del chat (`DIAS_RETENCION_MENSAJES`), y los datos del cliente de `Venta` se anonimizan a los 12 meses. Por eso toda métrica histórica sale de un agregado propio, sin datos personales, que no depende de los mensajes.
- Lo que se le mostró al cliente sólo existe como texto en el `content` de los mensajes `tool`. No hay ids estructurados, así que el interés por producto se registra aparte en el momento.
- La etapa de compra de Jev (`etapa-de-compra.ts`: `eligiendo` | `lista`) se calcula en cada turno y no se guarda en ningún lado.
- Una venta de stock no escribe `EventoVenta` al pagarse. El dato confiable del pago es `Venta.pagadaAt`.

## Base y período

- **Chat**: una `Conversation` de una cuenta de ventas con al menos un mensaje del cliente (`role = 'user'`) dentro del período. Quedan fuera el banco de pruebas (`web-test:`) y las ventas `dePrueba`.
- **Período**: días de negocio en `TIMEZONE`, con las mismas reglas que el histórico (`rangoDeDias`, `diasEntre`; máximo 366 días). Para comparar, se toma el período anterior de igual largo.

## Conversión

Hay dos tasas separadas y una tasa final:

| Tasa | Numerador | Base |
| --- | --- | --- |
| Chat → pedido | chats con al menos una `Venta` creada en el período (stock: `pendiente_pago` o posterior; a medida: `solicitado` / `a_cotizar` o posterior) | chats del período |
| Pedido → pago | pedidos que llegaron a `estado = 'pagada'` (`pagadaAt` no nulo) | pedidos creados en el período |
| Chat → pago (final) | chats con al menos una venta pagada | chats del período |

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

**Pendiente:**
- lectura y agregación (`GET /performance`);
- zona;
- clasificación de preguntas (`PreguntaChat`);
- tips;
- pantalla.
