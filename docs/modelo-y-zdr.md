# Qué modelo usar con Zero Data Retention

**Estado: decidido el 9/11/2026.** `OPENROUTER_MODEL=deepseek/deepseek-v4-flash`
en el servicio `api` de Railway, en develop y en production. El default del
código (`api/src/config/env.ts`) sigue siendo `google/gemma-4-31b-it`: rige sólo
donde la variable no está definida.

## Corrida del 9/11/2026 (la vigente)

**Por qué hubo que cambiar:** `inception/mercury-2.5`, el modelo que estaba en
producción, dejó de existir en OpenRouter (`404 … no provider serves this model
anymore`). Toda conversación terminaba en la disculpa genérica. `qwen/qwen3.8-flash`,
el recomendado en la corrida de septiembre, ya no tiene endpoints ZDR: tampoco sirve.

**Cómo se eligieron los candidatos**, del listado público de OpenRouter
(`/api/v1/models` y `/api/v1/endpoints/zdr`): `tools`, `reasoning` y
`structured_outputs` en `supported_parameters`, al menos un endpoint ZDR y
salida ≤ USD 0,60 por millón de tokens, el perfil de mercury.

**Qué se corrió:** `conversacion.eval.ts` (6 casos de agenda) y `ventas.eval.ts`
(13 casos contra una base Postgres con migraciones), una pasada por caso, con
`POLITICA_DE_PROVEEDOR` activa.

| Modelo | Precio entrada / salida | Ventas (casos · checks) | Ventas p50 / p90 | Conversación | Conv. p50 / p90 |
| --- | --- | --- | --- | --- | --- |
| **`deepseek/deepseek-v4-flash`** (elegido) | 0,09 / 0,18 | 10/13 · 95% | 6,0s / 9,8s | 6/6 · 100% | 5,7s / 19,1s |
| `nvidia/nemotron-3.5-lightning` | 0,07 / 0,20 | 11/13 · 97% | 3,2s / 7,8s | 6/6 · 100% | 4,7s / 11,3s |
| `google/gemini-3.1-flash-lite` | 0,25 / 1,50 | 11/13 · 97% | 4,8s / 6,6s | 6/6 · 100% | 3,2s / 6,3s |
| `inclusionai/ling-3.1-flash` | 0,045 / 0,135 | 12/13 · 98% | 8,9s / 21,0s | 6/6 · 100% | 18,3s / **69,8s** |
| `openai/gpt-oss-20b` | 0,03 / 0,13 | 8/13 · 85% | 3,1s / 7,3s | 5/6 · 93% | 1,2s / 7,6s |
| `google/gemma-4-26b-a4b-it` | 0,08 / 0,10 | 8/13 · 83% | 4,1s / 13,5s | 6/6 · 100% | 8,9s / 26,8s |
| `google/gemma-4-31b-it` (default del código) | 0,09 / 0,34 | 8/13 · 85% | 14,2s / 36,6s | 6/6 · 100% | 25,0s / 38,8s |

Precios en USD por millón de tokens, del listado de OpenRouter del 9/11. El
eval no midió costo: los dos caminos pasan por LangChain y reportan
`costoUsd: 0`.

**Fallos por modelo en ventas:**

- `sin-productos-propio` (`usaElTextoDelDueno`) lo fallan **los 7**: es casi
  seguro un check del arnés demasiado estricto, no del modelo. Revisarlo antes
  de la próxima corrida.
- `deepseek-v4-flash`: además, `con-errores-de-tipeo` (no encuentra el producto
  mal escrito) y `no-inventa-producto` (le pone precio a un producto que no
  está en el catálogo).
- `nemotron-3.5-lightning` y `gemini-3.1-flash-lite`: además,
  `cierra-con-algo-mas` (`soloMontosConocidos`, un monto sin respaldo).
- `gpt-oss-20b`, `gemma-4-31b-it` y `gemma-4-26b-a4b-it`: no completan la
  compra (`compra-completa`: sin pedido, ni productos, total ni nombre correctos)
  y no avisan que un producto no tiene stock. `gpt-oss-20b` además contesta un
  tema fuera de alcance y en conversación falla `mover-una-hora`.

**Por qué deepseek:** buena calidad en ventas sin la cola de latencia de
septiembre (p90 de 9,8s en ventas; el caso de 56s no se repitió), muchos
proveedores ZDR y precio parecido al de mercury.
`ling-3.1-flash` saca el mejor puntaje de ventas, pero su p90 de 70s en
conversación pasa el timeout de 40s del runtime.

**Pendiente:** `nemotron-3.5-lightning` salió apenas mejor que deepseek en las
dos suites, con menos latencia. Con una pasada por caso, un caso de diferencia
no alcanza para decidir: repetir `EVAL_MODELOS=deepseek/deepseek-v4-flash,nvidia/nemotron-3.5-lightning`
antes de cambiar otra vez. La lista por defecto de `api/evals/modelos.ts` todavía
incluye `inception/mercury-2.5` y `qwen/qwen3.8-flash`, que ya no rutean: pasar
`EVAL_MODELOS` explícito hasta actualizarla.

---

## Registro histórico: corrida del 12/09/2026

Lo que sigue es la decisión de septiembre, con datos de entonces. Quedó
superada por la corrida de arriba.

**Nota (post cambio a plantilla determinista):** la generación de agentes en
`/contanos` ya no llama a ningún modelo — usa una plantilla determinista
(`api/src/agents/agent-template.ts`), sin OpenRouter de por medio. Todo lo que
este documento dice sobre la generación (`generacion-agentes.eval.ts`,
`OPENROUTER_MODEL_AGENTES`, la Opción C de "separar los dos caminos", las
columnas "generación" de las tablas) queda como **registro histórico** de la
corrida del 12/09/2026, de antes de ese cambio — ya no hay una decisión
pendiente ahí. Lo que sigue abierto es sólo qué modelo usar para la
**conversación** (`OPENROUTER_MODEL`).

Fecha de los datos: 12 de septiembre de 2026.

## Contexto

Trato es un asistente de WhatsApp que agenda turnos en el Google Calendar
del titular. La conversación con el cliente y la generación de la configuración
del agente corren contra un modelo de lenguaje vía OpenRouter.

Google rechazó la verificación OAuth de la app, en parte porque parecía integrar
IA/ML con datos de Google Workspace sin declarar cumplimiento de **Limited Use**.
La respuesta fue, entre otras cosas, exigir no-entrenamiento y no-retención en
cada llamada al modelo. En `api/src/agents/openrouter.client.ts`:

```ts
export const POLITICA_DE_PROVEEDOR = {
  data_collection: 'deny',
  zdr: true,
} as const;
```

- `data_collection: 'deny'` rutea sólo a proveedores que no guardan los datos de
  forma no transitoria ni entrenan con ellos.
- `zdr: true` restringe el ruteo a endpoints con política de Zero Data Retention.

`api/src/conversation/llm.provider.ts` importa esa misma constante, así que viaja
en las dos rutas (meta-agente y runtime conversacional). Está publicado en
`/privacidad` y es parte de lo que se le responde a Google, así que
**no es negociable**: la decisión no es "si ZDR", es "qué modelo bajo ZDR".

Efecto colateral esperado: ZDR achica el conjunto de proveedores elegibles para
un mismo modelo, así que puede tocar latencia, costo o disponibilidad.

## Qué se midió

`npm run eval` desde `api/` (ver `api/evals/`). Dos suites contra OpenRouter
real:

- **`conversacion.eval.ts`**: 6 casos de conversación end to end contra un
  calendario falso en memoria (agendar, mover, cancelar, no agendar sin
  confirmar, rechazar sábado, no inventar precios). Es la que importa para la
  experiencia del cliente por WhatsApp.
- **`generacion-agentes.eval.ts`**: 6 perfiles de alta, genera el system prompt
  y las acciones habilitadas del agente. Es un JSON con structured outputs.

La corrida del 11/09 es **anterior** a la política de proveedor; la del 12/09 es
**con** `data_collection: deny` + `zdr: true`. Misma lista de modelos, mismos
casos.

## Resultado 1: ZDR no rompió el ruteo

Los 7 modelos respondieron. El eval de generación registró costo real
(`costoUsd` entre 0.0006 y 0.0035 por modelo), o sea que hubo ruteo y cobro
normales. **No hubo ningún error de routing por falta de endpoint ZDR.**

Dos aclaraciones para no leer mal los números:

- `openai/gpt-oss-120b` da 0/6 en generación **antes y después** (p50 de 77ms,
  12 llamadas = reintentos inmediatos). Falla desde antes y no tiene relación
  con este cambio.
- `costoUsd: 0` en la suite de conversación también venía de antes: ese camino
  pasa por LangChain y no reporta `usage`. No es un efecto de ZDR.

## Resultado 2: el modelo actual se puso el doble de lento

`google/gemma-4-31b-it` es el default actual (`api/src/config/env.ts`).

| conversación | 11/09 sin ZDR | 12/09 con ZDR | repetición con ZDR |
| --- | --- | --- | --- |
| casos OK | 6/6 | 5/6 | 5/6 |
| checks OK | 100% | 92% | 92% |
| p50 | 5.9s | 12.9s | 12.1s |
| p90 | 16.1s | 42.4s | 39.2s |
| peor caso | — | 63.7s | 53.9s |

La repetición se corrió aparte (`EVAL_MODELOS=google/gemma-4-31b-it`) justamente
porque el eval es una sola pasada por caso y el README avisa que conviene
repetir antes de decidir. **Las dos pasadas coinciden en la latencia**, así que
ese efecto es real y no ruido: ZERO retention dejó sólo proveedores más lentos
para este modelo.

Los 5/6 sí parecen ruido: falló un caso distinto en cada pasada
(`consulta-ambigua-no-agenda` con `hablaDeLosDias`, y `mover-una-hora` con
`quedaALas11`), y son checks blandos.

### Por qué la latencia importa más que el 5/6

`api/src/conversation/llm.provider.ts` tiene `TIMEOUT_MS = 40_000`. **Las dos
pasadas tuvieron al menos un caso por encima de 40s** (63.7s y 53.9s). En
producción eso aborta la llamada y el cliente recibe la disculpa genérica en
lugar de una respuesta. Y aun sin llegar al timeout, 40 segundos de espera en un
chat de WhatsApp es una mala experiencia de por sí.

Subir el timeout **no** es la solución: haría que el cliente espere más, no que
la respuesta llegue antes.

## Los candidatos

Precios en USD por millón de tokens de entrada / salida (de `api/evals/modelos.ts`,
relevados el 11/09/2026).

| modelo | precio | conversación 12/09 | p50 / p90 conv. | generación 12/09 |
| --- | --- | --- | --- | --- |
| `google/gemma-4-31b-it` *(actual)* | 0.09 / 0.34 | 5/6 · 92% | **12.9s / 42.4s** | 4/6 · 96% |
| `inception/mercury-2.5` | 0.04 / 0.15 | **6/6 · 100%** | **1.2s / 2.8s** | 4/6 · 94% |
| `google/gemini-3.1-flash-lite` | 0.25 / 1.50 | **6/6 · 100%** | 2.1s / 6.0s | 3/6 · 92% |
| `qwen/qwen3.8-flash` | 0.15 / 0.47 | **6/6 · 100%** | 2.7s / 9.9s | 3/6 · 94% |
| `google/gemma-4-26b-a4b-it` | 0.04 / 0.22 | 6/6 · 100% | 13.1s / 36.7s | **5/6 · 98%** |
| `deepseek/deepseek-v4-flash` | 0.09 / 0.17 | 5/6 · 92% | 7.6s / 17.7s | **5/6 · 98%** |
| `openai/gpt-oss-120b` | 0.04 / 0.17 | 2/6 · 67% | 3.4s / 6.8s | 0/6 · 0% (roto) |

### Cómo leer la columna de generación

El `casosOk` de generación es engañoso: **casi todos los modelos fallan el mismo
check** (`nombraTipos`) en el caso `maximo-20-tipos`, porque `META_SYSTEM_PROMPT`
pide un system prompt de ≤ 200 palabras y ahí no entran veinte tipos de turno
nombrados. Es una tensión del propio eval, no del modelo. El `checksOk` en
porcentaje es la señal más útil de esa suite.

Fallos de generación por modelo (12/09), para el que quiera mirar fino:

- `gemma-4-31b-it`: `nombraTipos` en `maximo-20-tipos` y en `nombres-raros`.
- `gemma-4-26b-a4b-it`: `nombraTipos` en `maximo-20-tipos`.
- `deepseek-v4-flash`: `nombraTipos` en `prod-otro-5-propios`.
- `qwen3.8-flash`: `nombraTipos` en `maximo-20-tipos`, `franja-una-hora`,
  `comercio-1-tipo`.
- `gemini-3.1-flash-lite`: `nombraTipos` ×3, más `nombraTitular` en
  `nombres-raros`.
- `mercury-2.5`: `nombraTipos` en `maximo-20-tipos`, más `nombraTitular` en
  `nombres-raros`.
- `gpt-oss-120b`: no genera nada en ningún caso.

## Restricciones que tiene que cumplir cualquier reemplazo

1. **`tools`** (tool calling): el grafo de conversación bindea las acciones como
   herramientas. Sin esto no funciona nada.
2. **`reasoning`**: el runtime lo llama con `{ effort: 'low', exclude: true }`,
   que es lo que le permite interpretar cómo escribe la gente por WhatsApp
   ("el jueves a la tardecita", "mejor movelo una hora").
3. **Structured outputs** (`response_format: json_schema` con `strict`): lo
   necesitan la generación de agentes y la extracción de productos de la
   importación rápida (`api/src/importacion/extraccion-ia.ts`, schema
   `productos_de_pagina`, sin razonamiento, 20 s), que además mandan
   `provider.require_parameters` para que OpenRouter no rutee a un proveedor que
   lo ignore. La extracción sólo corre para una página pública sin datos de
   producto ni secciones reconocibles, con el plan Pro.
4. **Endpoint con ZDR disponible**, o la llamada no rutea.

Los 7 de la tabla cumplen 1–3 (por eso están en la lista) y, según esta corrida,
también 4.

## Las opciones

### A. Dejar `google/gemma-4-31b-it` como está

Sin trabajo. El costo es que la conversación por WhatsApp queda con p50 de ~12s
y con casos que pasan el timeout de 40s y contestan una disculpa genérica.

### B. Cambiar sólo la conversación a `inception/mercury-2.5`

`OPENROUTER_MODEL=inception/mercury-2.5`. Diez veces más rápido que el actual
(p50 1.2s), 6/6 y 100% de checks en conversación, y más barato. Es el modelo más
nuevo de la lista, o sea el menos probado en el tiempo; en generación falla
`nombraTitular` con nombres raros.

### C. Separar los dos caminos

`OPENROUTER_MODEL=inception/mercury-2.5` para la conversación y
`OPENROUTER_MODEL_AGENTES=deepseek/deepseek-v4-flash` (o
`google/gemma-4-26b-a4b-it`) para la generación, que fueron los dos mejores de
esa suite bajo ZDR (5/6, 98%). La generación corre una sola vez por usuario en el
alta, así que ahí la latencia importa poco y la calidad importa mucho; la
conversación es al revés.

Esta separación ya está soportada: `OPENROUTER_MODEL_AGENTES` vacío cae a
`OPENROUTER_MODEL`, y el modelo elegido se persiste en `Agent.model`.

### D. `google/gemini-3.1-flash-lite` para conversación

6/6 y 100%, p50 2.1s. Es el más caro de la lista por un margen grande
(0.25 / 1.50 contra 0.04 / 0.15 de mercury): ~10x en salida, que es donde se
gasta. Se justifica sólo si se prefiere un proveedor más establecido que
Inception.

## Qué tan confiables son estos números

- **6 casos por suite, una sola pasada por caso** (dos para gemma en
  conversación). Las diferencias de aprobado/fallado entre corridas son ruido:
  en esta misma tanda `qwen` pasó de 5/6 a 3/6 en generación y
  `gemini-flash-lite` de 4/6 a 6/6 en conversación, sin que cambiara nada
  relevante.
- **La latencia sí es confiable**: la diferencia de gemma es de 2x y se repitió
  en dos pasadas independientes.
- La suite de conversación no reporta costo (`costoUsd: 0`) porque ese camino
  pasa por LangChain; los precios de la tabla salen de `modelos.ts` y son de
  relevamiento manual del 11/09.
- Antes de decidir por calidad conviene repetir: `npm run eval` de nuevo, o
  acotado con `EVAL_MODELOS=a,b`. Cuesta plata (centavos) y unos 15 minutos la
  tanda completa.

## Cómo aplicar la decisión

0. Verificar que el modelo exista y tenga endpoint ZDR (el listado de OpenRouter
   cambia: mercury desapareció y qwen perdió ZDR entre septiembre y noviembre).
1. `api/.env` en local: `OPENROUTER_MODEL=...` (y `OPENROUTER_MODEL_AGENTES=...`
   si se separan).
2. Railway, servicio `api`: las mismas variables. Reiniciar alcanza, no hace
   falta rebuild.
3. `api/src/config/env.ts`: el default (`'google/gemma-4-31b-it'`) si se quiere
   que el nuevo sea el valor por defecto del repo.
4. Tabla de variables del `README.md` de la raíz: dice cuál es el default.
5. Correr `npm run eval` una vez más con el modelo elegido para dejar el número
   registrado.
6. Los agentes ya generados guardan su modelo en `Agent.model`; cambiar la
   variable **no** los regenera. Para que un agente viejo use el nuevo modelo hay
   que rehacer el alta desde `/contanos`.

## Preguntas abiertas para quien aconseje

- ¿Conviene priorizar latencia (WhatsApp, gente esperando en un chat) o
  robustez del proveedor (Inception es nuevo)?
- Con 6 casos y una pasada, ¿alcanza para decidir, o vale la pena ampliar el set
  de casos antes de cambiar algo en producción?
- ¿Tiene sentido bajar `TIMEOUT_MS` de 40s a algo como 20s y responder antes con
  la disculpa, en vez de dejar a alguien esperando 40 segundos?
- Si el 5/6 de gemma fuera real y no ruido, ¿cambia la decisión, o la latencia
  ya alcanza para moverse igual?

## Archivos relevantes

- `api/src/agents/openrouter.client.ts` — `POLITICA_DE_PROVEEDOR`, el fetch a
  OpenRouter.
- `api/src/conversation/llm.provider.ts` — `ChatOpenAI` del runtime, `TIMEOUT_MS`,
  `reasoning`.
- `api/src/importacion/extraccion-ia.ts` — último recurso de la importación
  rápida para leer productos de una landing sin datos estructurados.
- `api/src/comercio/vision.client.ts` — `MODELO_VISION` (`google/gemma-4-31b-it`,
  acepta imagen y tiene endpoints con ZDR): describe las imágenes que manda el
  cliente y la imagen de un anuncio o de un estado del negocio (LAU-103). Si se cambia, el reemplazo
  tiene que aceptar `image_url` con ZDR.
- `api/src/comercio/anuncios.service.ts` — cuando el nombre del producto no
  aparece en el texto de un anuncio o estado, Jev (`DecisionesClient.probabilidades`) revisa dos veces (todo el anuncio y la imagen sola) y elige
  entre el catálogo con ese texto y la descripción de la imagen; gana el de mayor
  probabilidad promedio si le gana a "ninguno" (`ganadorPromedio`, anuncios.rules.ts).
- `api/src/config/env.ts` — defaults de `OPENROUTER_MODEL` y
  `OPENROUTER_MODEL_AGENTES`.
- `api/evals/` — los evals, los perfiles y la lista de modelos con precios.
- `api/evals/resultados/` — los JSON de cada corrida (gitignorados).
- `docs/verificacion-google.md` — por qué ZDR está ahí y qué más se cambió para
  la verificación.
