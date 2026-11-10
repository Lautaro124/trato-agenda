# Módulo de envíos (LAU-102)

Cada comercio carga a dónde llega, cuánto cuesta y cuánto demora. El asistente de ventas interpreta la consulta del cliente y la redacta. La cobertura, el precio y el plazo los decide un resolvedor determinístico (`api/src/envios/envios.rules.ts`). El MVP **sólo informa** tarifas configuradas: no cotiza con transportistas, no calcula por peso o volumen y no suma el envío al pedido ni al link de Mercado Pago (el asistente aclara que se paga aparte).

## Cómo se configura

Panel → **Envíos** (sólo cuentas de ventas):

1. **Configuración general**:
   - **Usar mis tarifas de envío**: el módulo prendido o apagado.
   - **Moneda**: una sola para todas las tarifas y umbrales.
   - **Si un destino no tiene tarifa**: derivar la consulta o avisar que se cotiza aparte.

   Si el comercio hace envíos se edita en Cuenta (`Agent.haceEnvios`). El retiro por el local y su dirección se editan en Asistente (`Agent.local`). Sin `haceEnvios`, el asistente no usa el módulo aunque esté prendido.
2. **Zonas**. Cada zona tiene:
   - **Nombre**: interno, el cliente no lo lee.
   - **Estado**: *tarifa definida*, *requiere cotización* o *sin cobertura*.
   - **Cobertura**: provincias, localidades, CP o regla general del país.
   - **Modalidades**: domicilio o sucursal, con su tarifa. Vacía es "sin precio" y 0 es "sin cargo", explícito.
   - **Envío gratis**: desde un subtotal.
   - **Plazos**: preparación más transporte, en días hábiles.
   - **Días de despacho** y aclaraciones.
3. **Probar respuestas** (`/envios/probar`): corre el mismo asistente de WhatsApp en un hilo descartable y muestra lo que resolvió `consultar_envio`. Cada prueba es una llamada real al modelo.
4. **Consultas que el asistente no pudo responder**: lo que quedó sin configurar, en conflicto, ambiguo o contradictorio en los últimos 30 días.

## Cómo resuelve

- **Prioridad:** gana la regla activa más específica, por modalidad: CP > localidad > provincia > país. Las excepciones "sin cobertura" siguen la misma prioridad.
- **Sin regla:** el destino queda `sin_configurar`, nunca "sin cobertura". El asistente sigue la acción configurada.
- **Conflictos:** dos zonas activas con el mismo lugar, nivel y modalidad (sin cobertura cuenta para todas). Al guardar o activar, la zona que choca queda pausada y el panel muestra el conflicto. Si igual aparece uno (una carrera), el resolvedor devuelve `conflicto` sin precio.
- **Destino parcial:** alcanza si todos los lugares posibles dentro de él reciben la misma respuesta. Si no, devuelve `falta_dato` con el dato que falta (localidad o CP).
- **Homónimos:** con "San Martín" o "Buenos Aires" se evalúa cada candidato, y sólo se pide la provincia si las respuestas difieren.
- **Ubicación dudosa:** un error de tipeo da `ubicacion_incierta` con candidatos, sin elegir uno. Los datos que no cierran dan `contradiccion`.
- **Envío gratis:** se compara con el subtotal de productos del pedido (con las promos por producto, sin recargo de cuotas ni descuento en efectivo, igual que `cotizarFormasDePago`), umbral incluido y en la misma moneda. Sin pedido, sólo se informa la condición.
- **Vigencia:** las reglas se leen en cada consulta, así que pausas y cambios valen desde la siguiente. El prompt le pide al modelo volver a llamar `consultar_envio` si cambia el destino o el pedido y no repetir costos anteriores.
- **Integración:** la herramienta `consultar_envio` se ofrece sólo con el módulo activo y `haceEnvios`. Apagado, el comportamiento es el de antes.

## Catálogo geográfico y limitaciones

- **Fuente:** las provincias y localidades vienen de la [API Georef](https://datosgobar.github.io/georef-ar-api/) (datos.gob.ar, CC-BY 4.0), con sus ids estables. `api/scripts/actualizar-georef.mjs` genera `api/src/envios/geo/georef-ar.data.ts`, que se versiona: el runtime no depende de Georef. Se deduplican las localidades repetidas como simple y como componente con el mismo nombre y departamento. Para actualizar: `node scripts/actualizar-georef.mjs` en `api/`.
- **Normalización:** sin tildes ni puntuación y con alias fijos de provincias (CABA, Bs As, Cba, Mza, TDF…). Nunca se elige una coincidencia por similitud.
- **Códigos postales:** **no hay catálogo CP → localidad**, porque no existe una fuente abierta oficial. Un CP vale sólo por las reglas por CP que cargue el dueño, cada una con su provincia y, opcionalmente, su localidad. La letra del CPA (X5000ABC) da la provincia. Con eso:
  - un CP de cuatro dígitos sin regla propia pide localidad o provincia cuando la respuesta depende de eso;
  - la contradicción CP/localidad sólo se detecta con la letra del CPA o con el lugar de la regla del CP;
  - una regla por CP sin localidad hace que las consultas por localidad de esa provincia pidan el CP cuando la respuesta cambia. Asignarle la localidad lo acota.
- **Privacidad:** las consultas sin resolver (`ConsultaEnvioSinResolver`) guardan sólo motivo y ubicación normalizada, sin conversación, dirección ni teléfono. Se borran a los 90 días (`retention.rules.ts`). No se registran las del dueño (banco de pruebas y probador).
