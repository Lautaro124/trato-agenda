# Diseño del experimento de comparación de modelos

Estado: documento completo, ejecución real bloqueada — nada de esto corrió contra OpenRouter en esta sesión.

## Baseline y candidatos

- Baseline: el modelo configurado actualmente en producción, `OPENROUTER_MODEL=google/gemma-4-31b-it` (`api/src/config/env.ts`).
- Candidatos iniciales (según el prompt de evaluación): `inception/mercury-2.5`, `deepseek/deepseek-v4-flash`, `google/gemini-3.1-flash-lite`, `qwen/qwen3.8-flash`.
- `docs/modelo-y-zdr.md` ya documentó una corrida previa a esta sesión (11 y 12/09/2026) sobre una lista algo más amplia (agrega `google/gemma-4-26b-a4b-it` y `openai/gpt-oss-120b`, este último roto — 0% de generación exitosa). Antes de cualquier corrida paga nueva, hay que reconfirmar disponibilidad, precio y endpoint ZDR de cada candidato a la fecha real de la corrida — los precios documentados en `api/evals/modelos.ts` están fechados "2026-09-11" y pueden haber cambiado.
- **Contradicción a resolver por el usuario, no por este documento**: `README.md` ya recomienda `OPENROUTER_MODEL=qwen/qwen3.8-flash` + `OPENROUTER_MODEL_AGENTES=google/gemini-3.1-flash-lite`, mientras que `docs/modelo-y-zdr.md` dice explícitamente "Estado: sin decidir". No se aplica ninguno de los dos sin que el usuario lo confirme.

## Separación de tareas

Generación (`agents.service.ts`), conversación (`llm.provider.ts` / grafo) y resumen (`persistir.node.ts`) se evalúan y comparan por separado — tienen perfiles de costo, latencia y reasoning distintos (generación y resumen corren con `reasoning: {enabled:false}`; conversación con `{effort:'low', exclude:true}`). Además de comparar modelo por tarea, se compara explícitamente la combinación **Mercury en conversación + DeepSeek en generación** (hipótesis del README, no resultado predefinido) contra usar el mismo modelo en las tres tareas.

## Órden de ejecución

1. Casos deterministas y fallos inyectados (Fase 0-4 de esta sesión: harness corregido, ~135 escenarios en `matriz-cobertura.csv`, PBT/fuzzing) — **ejecutados hoy, sin gasto**.
2. Piloto real pequeño, una vez aprobado presupuesto/modelos/duración/concurrencia — **NO EJECUTADO**.
3. Ampliación dentro del presupuesto aprobado — **NO EJECUTADO**.

Las 6 pruebas históricas de `api/evals/conversacion.eval.ts` (`CASOS`) y los 6 perfiles de `api/evals/generacion-agentes.eval.ts` (`PERFILES`) se conservan como baseline de referencia, pero no cuentan como cobertura suficiente — la matriz de 135 escenarios de esta sesión es la cobertura real.

## Repeticiones

Objetivo declarado por la spec: 5 repeticiones reales para escenarios críticos, 3 para normales, si el presupuesto lo permite. Sin presupuesto aprobado, la columna `repeticiones_planeadas` de `matriz-cobertura.csv` queda como objetivo, no como algo ejecutado.

## Cobertura pairwise y combinaciones triples de alto riesgo

No se hace producto cartesiano. Combinaciones dirigidas, ya con specs propios en esta sesión donde fue posible sin LLM real:

| Combinación | Cubierta por |
|---|---|
| Poca salida + tool call + reintento | `e2e/tests/salida-truncada.spec.ts` (RL2-001, bloqueado por infraestructura esta sesión) + `api/src/conversation/graph/adversarial/tool-calls-maliciosos.spec.ts` (RL2-002) |
| Confirmación antigua + historial reducido + cambio de horario | `api/src/conversation/graph/adversarial/agenda-limites.spec.ts` (B-028) |
| Concurrencia + respuesta perdida + escritura externa | `api/src/conversation/graph/adversarial/concurrencia.spec.ts` (E-001, E-004) |

## Property-based testing y fuzzing

`fast-check` (agregado como devDependency de `api/`, versión `^4.10.0`, compatible con Vitest 4.1.11 y Node 24 — verificado en esta sesión) sobre:
- `api/src/conversation/graph/agenda-rules.property.spec.ts`: `parsearFecha`, `esDiaHabil`, `conMargen`, `huecosDelDia`. Semilla 42, 200 runs por propiedad. Todas verdes en esta sesión.
- `api/evals/adversarial/fuzzing/json-acciones.fuzz.spec.ts`: nombres y argumentos de tool call arbitrarios contra el grafo real. Semilla 42, 150 runs, 2s de timeout por caso. Verde en esta sesión — ningún contraejemplo encontrado, por lo que no hay fixtures en `fuzzing/regresiones/` todavía.

## Relaciones metamórficas

Ver `api/src/conversation/graph/adversarial/metamorficas.spec.ts`: paráfrasis equivalentes preservan la decisión de validación (M-001), repetir un mensaje no duplica una escritura ya confirmada (E-002/M-002), cambiar de titular no arrastra `turnoActivo` ni `resumen` (M-003). La propiedad "una negación no se convierte en confirmación al resumir" (M-004/D-009) requiere el camino real de resumen contra OpenRouter — queda **bloqueada**, documentada en `api/evals/adversarial/resumen.eval.ts` (nuevo, gateado por `HAY_CLAVE`, no corrido).

## Controles negativos

`metamorficas.spec.ts` incluye un control negativo real (M-005): fuerza una violación de privilegios (una tool de propietario filtrada a un cliente) y comprueba que la aserción la atrapa — prueba que el harness detecta violaciones, no que el sistema es perfecto por definición.

## Metadatos por corrida (para cuando se apruebe la fase real)

Cada corrida real debe registrar: commit (`git rev-parse HEAD`), versión de Node (`v24.17.0` al momento de esta sesión), endpoint (`OPENROUTER_BASE_URL`), fecha, parámetros exactos enviados (`model`, `reasoning`, `provider`, `max_tokens`, `response_format`), semilla (cuando el proveedor la admita — documentar explícitamente si no la admite), y versión del dataset de fixtures (hash o fecha de `matriz-cobertura.csv`). No mezclar cambios de código de esta sesión con cambios de modelo en la misma comparación.

## Presupuesto y aprobación pendiente

Antes de ejecutar cualquier fila `bloqueado`/`requiere_presupuesto=true` de `matriz-cobertura.csv`, se necesita del usuario:
- Presupuesto máximo en USD.
- Modelos exactos a probar (confirmando que siguen existiendo y con ZDR a la fecha).
- Concurrencia máxima permitida contra OpenRouter real.
- Duración máxima de la corrida.

Sin eso, los comandos ya están escritos y comentados en cada fila correspondiente de la matriz (ej. `EVAL_MODELOS=deepseek/deepseek-v4-flash npm run eval -- conversacion`), listos para ejecutar en cuanto llegue la aprobación.
