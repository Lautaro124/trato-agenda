# Eliminación de datos y URL pública para Meta (LAU-108)

## URL a cargar en el panel de Meta

Campo «Instrucciones para la eliminación de datos» (URL, no callback):

`https://tratoagenda.com/privacidad#eliminar-datos`

Es una página pública, sin sesión, que explica el flujo real: **Cuenta → Eliminar mi cuenta** (`DELETE /auth/me`, `CuentaService.eliminar`). No se creó un callback: no hay login con Facebook, así que Meta no nos envía solicitudes de borrado por usuario.

## Qué hace la baja (código)

1. Deja la lápida de prueba (HMAC, sin mail ni número).
2. Revoca el token de Google.
3. Cancela la suscripción de Mercado Pago.
4. Desvincula WhatsApp: cierra el socket, descarta las ráfagas pendientes o en curso (`unlink` → `rafagas.descartar`) y borra credenciales.
5. Borra los checkpoints de LangGraph (fuera de la cascada Prisma).
6. Borra el usuario; la cascada elimina agente, conversaciones, mensajes, turnos, catálogo, ventas, avisos, tokens de MP, sugerencias y registro de performance (`cuenta.db.spec.ts`).

Se conserva: la lápida irreversible, los eventos ya escritos en Google Calendar y los issues ya creados en Linear. Respaldos del proveedor: rotación normal, hasta 30 días (dicho en /privacidad).

## Estado de la evidencia

| Ítem | Estado |
| --- | --- |
| Código: flujo y cascada cubiertos por tests | Hecho (`cuenta.db.spec.ts`, `whatsapp.service.spec.ts`) |
| Publicación: `/privacidad#eliminar-datos` en producción | Pendiente: se confirma tras el deploy de `main` |
| Configuración en Meta: URL cargada en el panel | Pendiente, manual. Registrar acá fecha y quién la cargó |
| Prueba de punta a punta con cuenta de prueba (sin clientes reales) | Pendiente, manual (e2e `cuenta-eliminada.spec.ts` usa stubs) |
