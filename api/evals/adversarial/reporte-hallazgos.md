# Reporte de hallazgos — evaluación integral y adversarial

Fecha: 2026-09-12/13. Alcance: fase offline (determinista, sin gasto). Nada de esto se corrió contra OpenRouter real.

## Resumen ejecutivo

- **135 escenarios únicos** trazados a `file:line` en `matriz/matriz-cobertura.csv` (secciones A-G + 7 dimensiones de recursos limitados + metamórficas/controles negativos).
- 2 bugs reales corregidos en el harness de medición existente (double-counting de tool calls, medición por-mensaje).
- 5 defectos/huecos de diseño reales encontrados y **no corregidos** (fuera de alcance sin autorización), listados abajo.
- 2 huecos de cobertura declarados explícitamente (no fabricados).
- Fase de comparación de modelos contra OpenRouter real: **bloqueada**, pendiente de aprobación de presupuesto.
- Fase Playwright/e2e y recursos limitados: **bloqueada por infraestructura** en esta sesión (ver sección correspondiente) — specs escritos y verificados por `tsc`, no ejecutados.

---

## Defectos y huecos de diseño (prioridad alta a baja)

### 1. `crear_turno`/`reprogramar_turno` sin idempotency key ante respuesta perdida de Google (E-004)

- **Archivo:línea**: `api/src/conversation/graph/nodes/calendar.node.ts:153-167`.
- **Escenario**: `calendarService.crearEvento` escribe en Google pero la respuesta se pierde (timeout de red post-escritura). El código no tiene forma de distinguir "nunca escribió" de "escribió pero no lo supimos": un reintento del cliente (o del propio flujo conversacional) puede crear un evento duplicado en Google Calendar real.
- **Causa**: no hay una clave de idempotencia (ej. un id determinístico derivado de `conversationId` + rango horario) pasada a la creación del evento.
- **Repro mínimo**: `api/src/conversation/graph/adversarial/concurrencia.spec.ts` → test `E-004`.
- **Impacto**: bajo en frecuencia (requiere timeout justo después de un 200 de Google), alto en severidad si ocurre (doble turno real en el calendario del dueño).
- **No corregido**: requiere decidir una estrategia de idempotencia (idempotency key soportada por la API de Google Calendar, o una tabla de "operaciones en curso") — cambio de comportamiento que necesita autorización del usuario.

### 2. Flujo "listar antes de confirmar" para acciones de propietario es sólo una instrucción de prompt, no una invariante de código (C-017)

- **Archivo:línea**: `api/src/conversation/graph/nodes/validacion.node.ts:287-311` (`cancelar_evento_calendario`, `editar_evento_calendario`).
- **Escenario**: el código sólo exige `args.confirmado === true`. No verifica que `listar_eventos_calendario` se haya llamado antes en la misma conversación, ni que el `eventoId` confirmado sea el mismo que se listó. Un modelo (o un prompt injection exitoso) que emita directamente `cancelar_evento_calendario({eventoId: 'x', confirmado: true})` sin el paso previo se ejecuta igual.
- **Repro mínimo**: `api/src/conversation/graph/adversarial/tool-calls-maliciosos.spec.ts` → test `C-017`.
- **Impacto**: medio — sólo alcanzable por el propio dueño (`esPropietario`) o por quien logre hacerse pasar por él en el banco de pruebas del Home; no expone datos de otros titulares, pero sí permite cancelar/editar un evento del calendario del dueño sin la doble confirmación que el producto promete.
- **No corregido**: requiere agregar estado de sesión de conversación (qué se listó y cuándo) — cambio de comportamiento, necesita autorización.

### 3. Catálogo de tipos de uso duplicado entre `api/` y `web/`, sin fuente compartida (A-021)

- **Archivo:línea**: `api/src/agents/agent-catalog.ts:24` vs `web/src/app/contanos/useOnboarding.ts` (bloque `TIPOS_USO`).
- **Estado actual**: los ids coinciden hoy (verificado por `api/src/agents/adversarial/catalogo-drift.spec.ts`, en verde). El riesgo es estructural: no hay paquete compartido entre `api/` y `web/`, así que un cambio a uno solo de los dos lados (agregar/renombrar un tipo de uso) pasaría los tests de cada lado por separado y sólo se notaría en producción, cuando el wizard mande un `tipoUso` que el backend valida contra un catálogo desactualizado.
- **Mitigación ya aplicada**: el test de regresión queda en el repo — el día que diverjan, falla en CI antes que en producción.
- **No corregido de fondo**: unificar el catálogo en un paquete compartido es un cambio de arquitectura, fuera de alcance sin autorización.

### 4. `tool_call_id` duplicado dentro de un mismo `AIMessage` no se deduplica (C-006)

- **Archivo:línea**: `api/src/conversation/graph/nodes/validacion.node.ts:319-352` (`crearNodoValidacion`), `api/src/conversation/graph/state.ts:64-70` (`llamadasDe`).
- **Escenario**: si el modelo emite dos tool calls con el mismo `id` en el mismo mensaje (comportamiento no válido de OpenAI/OpenRouter, pero no imposible ante un proveedor con bug), ambas se procesan y generan dos `ToolMessage` con el mismo `tool_call_id`. Según el proveedor, esto podría confundir el emparejamiento pregunta/respuesta en la siguiente vuelta.
- **Repro mínimo**: `api/src/conversation/graph/adversarial/tool-calls-maliciosos.spec.ts` → test `C-006`.
- **Impacto**: bajo — depende de un comportamiento anómalo del proveedor, no del propio sistema.
- **No corregido**: agregar deduplicación por id es una corrección de comportamiento menor; no se aplicó sin autorización explícita.

### 5. Huecos de cobertura declarados (no fabricados)

- **F-012 / G-002**: no se encontró (en esta pasada de exploración) un spec dedicado a `api/src/whatsapp/whatsapp.service.ts` que confirme (a) que un mensaje de un chat de grupo se descarta y (b) que `handleMessagesUpsert` corta antes de invocar el grafo cuando `asistenteActivo=false`. El código (`whatsapp.service.ts:170`, visto durante la exploración) sugiere que sí lo hace, pero no se escribió/verificó un test nuevo para esto por alcance de tiempo de la sesión. Marcado `no_aplicable` en la matriz, no `implementado`.
- **G-003**: no existe hoy un mecanismo de test (endpoint dev-only o control de reloj del servidor) para forzar `estadoDeSuscripcion` a `"vencida"` en el banco de pruebas del Home sin acceso directo a la base. Marcado `bloqueado` en la matriz.
- **D-009/M-004**: "una negación no se convierte en confirmación al resumir" requiere el camino real de resumen contra OpenRouter (`api/evals/adversarial/resumen.eval.ts`, escrito pero gateado por `HAY_CLAVE`, no corrido).

---

## Bugs de harness corregidos (no del sistema bajo prueba)

### Double-counting de tool calls en `api/evals/conversacion.eval.ts`

- **Antes**: `estado.messages.slice(-12)` sobre un `thread_id` persistente entre invokes del mismo caso — con pocos mensajes por caso, la ventana fija podía recontar tool calls de una vuelta anterior.
- **Corrección**: cursor (`mensajesContados`) + `Set<string>` de `tool_call.id` ya vistos, extraído a una función pura y testeable: `api/evals/adversarial/medicion.ts` → `contarToolCallsNuevas`.
- **Regresión**: `api/evals/adversarial/medicion.spec.ts` (3 tests, reproduce el escenario exacto del bug y confirma que no vuelve a ocurrir).

### Medición por-mensaje, no por-llamada-LLM

- `api/evals/conversacion.eval.ts` sigue midiendo `grafo.invoke` por mensaje (correcto para lo que ese eval mide), pero ahora existe instrumentación separada por capas (`cola`/`intento_http`/`llamada_logica`/`tool`/`mensaje`/`conversacion`) en `api/evals/adversarial/medicion.ts`, lista para usarse en futuras corridas reales sin deducir timeouts de la duración total.

---

## Nota de higiene de tests (no es un defecto de producción)

Durante la escritura de `historial-resumen.spec.ts` se encontró que reutilizar la **misma instancia** de `AIMessage` como respuesta fija de un modelo falso a través de **múltiples invokes del mismo thread** confunde al reductor de mensajes del checkpointer de LangGraph (la segunda vez, el mensaje "desaparece" del estado final). En producción esto no ocurre: el nodo real (`conversacion.node.ts`) siempre construye un `AIMessage` nuevo por invocación al modelo. Documentado para que futuros specs de este estilo no reutilicen instancias de mensaje entre invokes del mismo `thread_id`.

---

## Bloqueos de infraestructura de esta sesión

- **E2E de Playwright**: el stack de e2e (`docker-compose.e2e.yml`) usa los mismos puertos host que el stack de desarrollo ya en ejecución (5432/4000/3000, sin override de puertos). Se intentó levantarlo (`docker compose -p trato-e2e -f docker-compose.yml -f docker-compose.e2e.yml up -d openrouter-stub db`) y falló limpiamente por `port is already allocated` en `db`, sin afectar el stack de desarrollo (confirmado con `docker ps` antes/después). Se hizo `down -v` del intento para no dejar contenedores/volúmenes huérfanos. Los 4 specs nuevos (`sesion-vencida`, `webhook-suscripcion`, `cuenta-eliminada`, `salida-truncada`) y la extensión del stub (`[corte-N]`) están escritos y pasan `tsc --noEmit` sin errores, pero no se ejecutaron. Comando para correrlos una vez liberados los puertos (parar el stack de dev primero): `docker compose down && cd e2e && npm run e2e:stack && npm run e2e && npm run e2e:stack:down`.
- **Recursos limitados (CPU/RAM)**: `docker-compose.recursos-limitados.yml` (nuevo) valida con `docker compose config` sin errores, pero no se ejecutó por el mismo conflicto de puertos — es un override sobre el mismo stack de e2e.
- **Carga local**: `api/evals/adversarial/carga/carga-local.ts` (nuevo) requiere el stack de e2e arriba; no se ejecutó por la misma razón.

## Incidente de seguridad del proceso (declarado, no del código)

En un paso intermedio de esta sesión se invocó por error `vitest --config ./vitest.config.eval.ts` para chequear tipos de un archivo nuevo, sin darse cuenta de que `import 'dotenv/config'` en esos archivos recarga `api/.env` (que tiene una clave real de OpenRouter) incluso con la variable `unset` en el shell. Esto disparó por ~2 minutos los `describe` reales de comparación de modelos contra OpenRouter, sin aprobación de presupuesto, antes de ser detectado y abortado. Comunicado al usuario en el momento; no se encontró un archivo de resultados nuevo en `api/evals/resultados/`, lo que sugiere que ningún caso llegó a completarse, pero no puede garantizarse gasto cero. Ver memoria del proyecto (`nunca-correr-vitest-eval-config.md`) para que no se repita.

## Contradicción de recomendación de modelo (no resuelta)

`README.md:190-198` recomienda `OPENROUTER_MODEL=qwen/qwen3.8-flash` + `OPENROUTER_MODEL_AGENTES=google/gemini-3.1-flash-lite`. `docs/modelo-y-zdr.md` (mismo repositorio, fecha más reciente) dice explícitamente "Estado: sin decidir" y no recomienda ninguno. Esta sesión no resuelve la contradicción ni cambia ningún default — queda para que el usuario decida, con el diseño de experimento (`diseno-experimento.md`) listo para ejecutar en cuanto se apruebe presupuesto.
