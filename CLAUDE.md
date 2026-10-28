# CLAUDE.md

## Proyecto

Trato (`tratoagenda.com`) atiende clientes por WhatsApp con un asistente de IA: agenda turnos o vende productos. Cada cuenta elige un tipo de asistente y no lo cambia después. Login, vinculación, agenda, conversaciones y pagos son integraciones reales; los stubs pertenecen a E2E.

- `api/`: NestJS 12, ESM, Prisma 7, Postgres 16 + pgvector, LangGraph y Baileys.
- `web/`: Next.js 16 App Router, React 19, TypeScript y Tailwind v4. Alias `@/*` → `web/src/*`.
- `e2e/`: Playwright, con stack y base aislados.
- Textos de interfaz y comentarios en español; usar voseo rioplatense.

## Comandos y validación

Configuración, variables y despliegue: [README.md](README.md). La API requiere `api/.env`; `.env.example` configura el Compose local. Nunca commitear secretos.

| Directorio | Comando | Uso |
| --- | --- | --- |
| raíz | `docker compose up --build` | DB :5432, API :4000, web :3000 |
| `api/` | `npm run start:dev` | Desarrollo (preferible dentro de Compose) |
| `api/` | `npm run lint`, `npm test`, `npm run build` | oxlint, Vitest y compilación |
| `web/` | `npm run dev`, `npm run lint`, `npm run build` | Desarrollo, ESLint y compilación |
| `e2e/` | `npm run e2e:stack`, `npm run e2e` | Stack aislado; escritorio y móvil |
| `e2e/` | `npm run typecheck` | Tipos de los tests |

- Ejecutar las verificaciones relevantes al cambio; la web no tiene runner de tests unitarios.
- Los `*.db.spec.ts` requieren `TEST_DATABASE_URL` con migraciones y pgvector; sin ella se omiten.
- Generar migraciones en una DB descartable: las tablas de LangGraph están fuera de Prisma y provocan drift en la principal. No resetear bases con datos para resolverlo. Producción aplica `prisma migrate deploy` al arrancar.
- `npm run eval` en `api/` y `npm run e2e:real` en `e2e/` usan OpenRouter real y cuestan dinero; no forman parte de los tests normales. Evaluar antes de cambiar el modelo.
- E2E usa stubs de OpenRouter, Mercado Pago e importación. Usar la fixture `usuarioDev` por test y selectores por rol/label, no `data-testid` ni resets globales de DB.

## Reglas que hay que preservar

### Sesión y privacidad

- La API administra `trato_session` (`httpOnly`). La web usa `SessionProvider`, `useRequireSession` y `apiFetch` con `credentials: "include"`. No compartir `JWT_SECRET` con Next ni agregar un `proxy.ts` que valide el JWT.
- Mantener CORS, chequeo de origen, cookies y límites de intentos de `api/src/auth/`. El login de desarrollo tiene tres bloqueos de producción: registro del controlador, handler y validación de entorno; conservarlos.
- `User.calendario` decide entre Google y agenda local. Un token de Google ausente/inválido no debe convertirse silenciosamente en agenda local.
- Tokens de Google, Mercado Pago y credenciales de WhatsApp permanecen cifrados en la API. La web sólo recibe las formas públicas.
- Mantener `POLITICA_DE_PROVEEDOR` (`data_collection: 'deny', zdr: true`) en las llamadas a OpenRouter. El modelo de conversación debe soportar tools y reasoning. No registrar prompts, conversaciones, teléfonos, emails ni cuerpos de errores del proveedor.
- Sentry es opcional: conservar scrubbing en API y web y la carga temprana de `instrument.ts` en ESM. No habilitar Replay, integraciones de IA ni categorías de recolección sin actualizar la documentación de privacidad y verificación de Google.
- Cambiar scopes de Google exige sincronizar la consola y el código y considerar el reconsentimiento. Cambiar retención exige actualizar `/privacidad`. La eliminación de cuenta también borra threads de LangGraph, fuera de la cascada Prisma; deja los eventos ya escritos en Google.

### Asistentes y reglas de negocio

- Los agentes se generan con plantillas deterministas en `api/src/agents/`, sin llamada al modelo. Subir `PLANTILLA_VERSION` o `PLANTILLA_VENTAS_VERSION` regenera agentes existentes al próximo arranque, incluida producción.
- `Agent.tipoAsistente` distingue agenda/ventas; `tipoUso` no. Las reglas se validan en código, no sólo en el prompt. Los campos libres interpolados deben tratarse como datos.
- Conversaciones: LangGraph en `api/src/conversation/`; herramientas del propietario sólo en el banco de pruebas del Home. Conservar aislamiento por usuario/conversación y validación antes de efectos externos.
- Agenda individual: días hábiles, franja, margen, nombre y ausencia de solapamientos. Clases grupales: horario fijo y cupo; no aplicarles la franja individual. Mantener la comprobación final y los controles de concurrencia al reservar.
- Ventas: precios y totales salen del código/DB, nunca del modelo. Preservar reservas transaccionales, snapshots del pedido, estados de presupuestos y procesamiento idempotente de pagos. Stock y productos a medida conviven por producto (`Producto.solicitud`).
- Un pedido tiene una moneda; USD se cobra manualmente. Productos a medida, presupuestos, costos y suscripciones usan ARS. No inventar conversiones ni acumular descuentos.
- Suscripciones: precios y funciones vienen de la API. El cupo de chats es informativo; al vencer sin pago se suspende el asistente, no el acceso a las pantallas. Importación rápida requiere Pro pago, no prueba gratuita. Un cambio de plan sólo se adopta tras autorización de Mercado Pago.
- Webhooks de Mercado Pago: verificar HMAC y releer el recurso desde MP; no confiar en el payload ni duplicar efectos.

### WhatsApp y despliegue

- Producción en Railway: `main` despliega API y web por separado. API con una sola réplica y sin suspensión: dos procesos compiten por las sesiones Baileys.
- Mantener agrupación y serialización por chat, límites de ráfaga y cancelación antes de efectos; después de comprometer una acción no repetirla.
- Horario de atención (LAU-29): es de la cuenta y se chequea al recibir, después de la suscripción y antes de las ráfagas. Fuera de horario, silencio salvo conversación en curso; su zona horaria no cambia la de agenda/ventas.
- Vinculación por QR o código con SSE. `creds.me` no demuestra vinculación: verificar registro. No reconectar códigos pendientes ni renombrar `Browsers.ubuntu('Chrome')`, necesario para el pairing.
- Conservar historial desactivado y `markOnlineOnConnect: false`, reintentos, cifrado de claves y espera de guardados antes de transferir una sesión. Métricas sólo con ids y números.
- Variables `NEXT_PUBLIC_*` se incorporan en build; pasarlas al build de Docker. Prisma CLI debe seguir disponible en la imagen de producción para migrar.

## Frontend y diseño

- Leer `web/AGENTS.md` y la guía relevante de `web/node_modules/next/dist/docs/` antes de cambios de Next. `web/CLAUDE.md` importa esas reglas; `next dev` regenera el bloque, no revertirlo para ocultar el diff.
- Sistema visual en `web/src/app/globals.css`: primitivas → tokens semánticos → aliases Tailwind. Usar `bg-primary`, `text-ink`, `bg-page`, etc.; variables crudas sólo si no hay alias.
- Mantener prefijo `--ds-` en radios/sombras y variables de `next/font` sobre `<html>`.
- Reutilizar `web/src/components/ui/`. `cn` sólo concatena clases: no resuelve conflictos como tailwind-merge.
- Mantener sincronizadas las validaciones/catálogos copiados entre API y web cuando se modifiquen sus reglas.

## Seguridad y documentación de consulta

- No omitir el hook `Stop` de `.claude/settings.json` / `.claude/hooks/validar-seguridad.sh`: pide revisión paralela de `revisor-seguridad` y `security-auditor` sobre cambios sin pushear, corregir HIGH/MEDIUM y volver a revisar el diff modificado (máximo tres rondas). Sus instrucciones están en `.claude/agents/`.
- CI en `.github/workflows/`: mantener actions fijadas por SHA, imágenes sin root y controles de seguridad. Excepciones de auditoría sólo por el mecanismo existente de `.github/npm-audit-excepciones.json`; no quitar overrides de dependencias hasta que el padre incorpore el arreglo.
- [Seguridad](docs/seguridad.md): controles y pendientes.
- [Verificación de Google](docs/verificacion-google.md): scopes, datos, privacidad y pasos manuales.
- [Modelo y ZDR](docs/modelo-y-zdr.md): selección y restricciones del proveedor.
- [Performance](docs/performance.md): definiciones de conversión, etapas, zona y preguntas del módulo de performance (LAU-30).
- [Referencia técnica](docs/referencia-tecnica.md): detalle histórico de módulos, flujos, stubs y decisiones. Leer sólo la sección pertinente y contrastarla con código/tests; no cargarla completa por defecto.

Mantener este archivo breve: instrucciones estables y enlaces. Los detalles de implementación pertenecen al código, tests o documentación específica.
